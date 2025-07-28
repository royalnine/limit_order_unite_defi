import express from 'express';
import { createHash } from 'crypto';
import { ethers, Interface } from 'ethers';
import dotenv from 'dotenv';
import {
  LimitOrder,
  MakerTraits,
  Address,
  ExtensionBuilder,
  Interaction
} from '@1inch/limit-order-sdk';

dotenv.config();

interface LimitOrderV4Struct {
  salt: string;
  maker: string;
  receiver: string;
  makerAsset: string;
  takerAsset: string;
  makingAmount: string;
  takingAmount: string;
  makerTraits: string;
}

interface SubmitOrderRequest {
  order: LimitOrderV4Struct;
  signature: string;
}

interface StoredOrder {
  id: string;
  order: LimitOrderV4Struct;
  signature: string;
  timestamp: number;
  reconstructedOrder?: LimitOrder;
}

// Constants from backend
const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const AAVE_POOL_ADDRESS = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const MULTICALL3_ADDRESS = '0xca11bde05977b3631167028862be2a173976ca11';
const LIMIT_ORDER_PROTOCOL_ADDRESS = '0x7F069df72b7A39bCE9806e3AfaF579E54D8CF2b9';

const orderStorage = new Map<string, StoredOrder>();

// Setup RPC provider
const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc');
const fillerWallet = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

function encodeAaveSupply(amount: bigint, trader: Address): string {
    const aavePoolAbi = [
        'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
    ];
    const poolInterface = new Interface(aavePoolAbi);

    const supplyCalldata = poolInterface.encodeFunctionData('supply', [
        WETH_ADDRESS,
        amount,
        trader.toString(),
        0 // referralCode
    ]);

    return supplyCalldata;
}

function buildMulticallInteraction(aaveAmount: bigint, onBehalfOf: Address): Interaction {
    const multicallAbi = [
        'function aggregate3Value(tuple(address target,bool allowFailure,uint256 value,bytes callData)[] calls) returns (tuple(bool success, bytes returnData)[] returnData)'
    ];

    const multicallInterface = new Interface(multicallAbi);

    const supplyCalldata = encodeAaveSupply(aaveAmount, onBehalfOf);

    const multicallData = multicallInterface.encodeFunctionData('aggregate3Value', [
        [[AAVE_POOL_ADDRESS, false, 0, supplyCalldata]]
    ]);

    return new Interaction(new Address(MULTICALL3_ADDRESS), multicallData);
}

function reconstructOrderWithExtension(orderStruct: LimitOrderV4Struct): LimitOrder {
    const makerAddress = new Address(orderStruct.maker);
    const makingAmount = BigInt(orderStruct.makingAmount);
    
    // Build the multicall interaction (same as in backend)
    const multicallInteraction = buildMulticallInteraction(makingAmount, makerAddress);
    const customExtension = new ExtensionBuilder().withPostInteraction(multicallInteraction).build();
    
    // Reconstruct the order with extension
    const reconstructedOrder = LimitOrder.fromDataAndExtension(orderStruct, customExtension);
    
    return reconstructedOrder;
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

function generateOrderId(order: LimitOrderV4Struct): string {
  const orderString = JSON.stringify(order);
  return createHash('sha256').update(orderString).digest('hex');
}

app.post('/submit-order', (req, res) => {
  try {
    const { order, signature }: SubmitOrderRequest = req.body;
    
    if (!order || !signature) {
      return res.status(400).json({ error: 'Missing order or signature' });
    }

    const orderId = generateOrderId(order);
    
    if (orderStorage.has(orderId)) {
      return res.status(409).json({ error: 'Order already exists' });
    }

    // Reconstruct the order with extensions
    const reconstructedOrder = reconstructOrderWithExtension(order);
    
    const storedOrder: StoredOrder = {
      id: orderId,
      order,
      signature,
      timestamp: Date.now(),
      reconstructedOrder
    };

    orderStorage.set(orderId, storedOrder);

    console.log(`Order stored with ID: ${orderId}`);
    console.log('Received order:', order);
    console.log('Reconstructed order with extension:', reconstructedOrder.build());
    
    res.json({ 
      success: true, 
      message: 'Order received and stored successfully',
      orderId 
    });
  } catch (error) {
    console.error('Error processing order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/orders', (req, res) => {
  const orders = Array.from(orderStorage.values());
  res.json(orders);
});

app.get('/orders/:id', (req, res) => {
  const { id } = req.params;
  const order = orderStorage.get(id);
  
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  
  res.json(order);
});

async function fillOrderOnProtocol(storedOrder: StoredOrder): Promise<any> {
  try {
    if (!storedOrder.reconstructedOrder) {
      throw new Error('Order not reconstructed');
    }

    const limitOrderProtocolAbi = [
      'function fillOrder((uint256 salt, address maker, address receiver, address makerAsset, address takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order, bytes signature, uint256 makingAmount, uint256 takingAmount, uint256 thresholdAmount) returns (uint256, uint256)'
    ];

    const contract = new ethers.Contract(
      LIMIT_ORDER_PROTOCOL_ADDRESS,
      limitOrderProtocolAbi,
      fillerWallet
    );

    const orderStruct = storedOrder.reconstructedOrder.build();
    const takingAmount = BigInt(orderStruct.takingAmount);
    const makingAmount = BigInt(orderStruct.makingAmount);

    // Fill the entire order
    const tx = await contract.fillOrder(
      orderStruct,
      storedOrder.signature,
      makingAmount,
      takingAmount,
      takingAmount // thresholdAmount - minimum amount we're willing to receive
    );

    const receipt = await tx.wait();
    
    return {
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString()
    };
  } catch (error) {
    console.error('Error filling order:', error);
    throw error;
  }
}

app.post('/fill-order/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const storedOrder = orderStorage.get(id);
    
    if (!storedOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (!process.env.FILLER_PRIVATE_KEY) {
      return res.status(500).json({ error: 'Filler private key not configured' });
    }

    console.log(`Attempting to fill order ${id}`);
    
    const result = await fillOrderOnProtocol(storedOrder);
    
    res.json({
      success: true,
      message: 'Order filled successfully',
      orderId: id,
      transaction: result
    });
    
  } catch (error) {
    console.error('Error filling order:', error);
    res.status(500).json({ 
      error: 'Failed to fill order',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Order resolver server running on port ${PORT}`);
});