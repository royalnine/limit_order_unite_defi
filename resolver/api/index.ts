import express from 'express';
import cors from 'cors';
import { createHash } from 'crypto';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import {
  LimitOrder,
  Address,
  Extension
} from '@1inch/limit-order-sdk';
import { TakerTraits } from '@1inch/limit-order-sdk'


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
  extension: string;
  limitPriceUsd: number;
  isLong: boolean;
}

interface StoredOrder {
  id: string;
  order: LimitOrderV4Struct;
  signature: string;
  timestamp: number;
  reconstructedOrder?: LimitOrder;
  limitPriceUsd: number;
  isLong: boolean;
}

const LIMIT_ORDER_PROTOCOL_ADDRESS = '0x111111125421cA6dc452d289314280a0f8842A65';
const MAKER_PRIVATE_KEY = process.env.MAKER_PRIVATE_KEY;
const TAKER_PRIVATE_KEY = process.env.TAKER_PRIVATE_KEY;
const POST_INTERACTION_ADDRESS = '0x8815Ab44465734eF2C41de36cff0ab130e1ab32B';
const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY;

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

const orderStorage = new Map<string, StoredOrder>();

// Setup RPC provider
const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL as string);
const makerWallet = new ethers.Wallet(MAKER_PRIVATE_KEY!, provider);
const takerWallet = new ethers.Wallet(TAKER_PRIVATE_KEY!, provider);


function reconstructOrderWithExtension(orderStruct: LimitOrderV4Struct, extension: string): LimitOrder {
    const extensionObj = Extension.decode(extension);
    const reconstructedOrder = LimitOrder.fromDataAndExtension(orderStruct, extensionObj);
    
    return reconstructedOrder;
}

const app = express();

// Enable CORS for all routes and origins
app.use(cors({
  origin: '*', // Allow requests from any origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

function generateOrderId(order: LimitOrderV4Struct): string {
  const orderString = JSON.stringify(order);
  return createHash('sha256').update(orderString).digest('hex');
}

function serializeOrderForJSON(order: StoredOrder): any {
  return {
    id: order.id,
    order: order.order,
    signature: order.signature,
    timestamp: order.timestamp,
    limitPriceUsd: order.limitPriceUsd,
    isLong: order.isLong,
    // Convert reconstructedOrder to serializable format if it exists
    reconstructedOrder: order.reconstructedOrder ? {
      orderStruct: order.reconstructedOrder.build(),
      extension: order.reconstructedOrder.extension.encode(),
      salt: order.reconstructedOrder.salt.toString(),
      maker: order.reconstructedOrder.maker.toString(),
      receiver: order.reconstructedOrder.receiver.toString(),
      makerAsset: order.reconstructedOrder.makerAsset.toString(),
      takerAsset: order.reconstructedOrder.takerAsset.toString(),
      makingAmount: order.reconstructedOrder.makingAmount.toString(),
      takingAmount: order.reconstructedOrder.takingAmount.toString(),
      makerTraits: order.reconstructedOrder.makerTraits.toString()
    } : undefined
  };
}

async function getSpotPrices(makerTokenAddress: string, takerTokenAddress: string): Promise<{ makerTokenPrice: number, takerTokenPrice: number }> {
  const priceEndpointBaseURL = `https://api.1inch.dev/price/v1.1/8453/${makerTokenAddress},${takerTokenAddress}`

  const response = await fetch(`${priceEndpointBaseURL}?currency=USD`, {
    headers: {
      'Authorization': `Bearer ${ONEINCH_API_KEY}`
    }
  });
  const data = await response.json();
  const makerTokenPrice = data[makerTokenAddress];
  const takerTokenPrice = data[takerTokenAddress];
  return { makerTokenPrice, takerTokenPrice };
}

async function getFillableOrders(): Promise<StoredOrder[]> {
  const fillableOrders: StoredOrder[] = [];
  
  // Use for...of instead of forEach for async operations
  for (const order of orderStorage.values()) {
    try {
      const { makerTokenPrice, takerTokenPrice } = await getSpotPrices(order.order.makerAsset, order.order.takerAsset);
      const priceRatio = takerTokenPrice / makerTokenPrice;
      
      console.log(`Order ${order.id}: limitPriceUsd=${order.limitPriceUsd}, priceRatio=${priceRatio}, isLong=${order.isLong}`);
      
      if (order.isLong) {
        if (order.limitPriceUsd < priceRatio) {
          fillableOrders.push(order);
          console.log(`Order ${order.id} is fillable (long)`);
        }
      } else {
        if (order.limitPriceUsd > priceRatio) {
          fillableOrders.push(order);
          console.log(`Order ${order.id} is fillable (short)`);
        }
      }
    } catch (error) {
      console.error(`Error processing order ${order.id}:`, error);
    }
  }
  
  console.log('fillableOrders', fillableOrders);
  return fillableOrders;
}

app.get('/fillable-orders', async (req, res) => {
  const fillableOrders = await getFillableOrders();
  const serializedOrders = fillableOrders.map(serializeOrderForJSON);
  res.json(serializedOrders);
});

app.post('/submit-order', (req, res) => {
  try {
    const { order, signature, extension, limitPriceUsd, isLong }: SubmitOrderRequest = req.body;
    
    if (!order || !signature) {
      return res.status(400).json({ error: 'Missing order or signature' });
    }

    const orderId = generateOrderId(order);
    
    if (orderStorage.has(orderId)) {
      return res.status(409).json({ error: 'Order already exists' });
    }

    // Reconstruct the order with extensions
    const reconstructedOrder = reconstructOrderWithExtension(order, extension);
    
    const storedOrder: StoredOrder = {
      id: orderId,
      order,
      signature,
      timestamp: Date.now(),
      reconstructedOrder,
      limitPriceUsd,
      isLong
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
      'function fillOrderArgs((uint256 salt, uint256 maker, uint256 receiver, uint256 makerAsset, uint256 takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order, bytes32 r, bytes32 vs, uint256 amount, uint256 takerTraits, bytes args) returns (uint256, uint256, bytes32)'
    ];

    const contract = new ethers.Contract(
      LIMIT_ORDER_PROTOCOL_ADDRESS,
      limitOrderProtocolAbi,
      takerWallet
    );

    const orderStruct = storedOrder.reconstructedOrder.build();
    const takingAmount = BigInt(orderStruct.takingAmount);

    // Parse signature into r and vs components for compact signature format
    const signature = storedOrder.signature;
    console.log('Full signature:', signature);
    console.log('Signature length:', signature.length);
    
    const r = signature.slice(0, 66); // First 32 bytes + 0x
    const s = signature.slice(66, 130); // Next 32 bytes
    const v = signature.slice(130, 132); // Last byte
    
    console.log('r:', r, 'length:', r.length);
    console.log('s:', s, 'length:', s.length);
    console.log('v:', v, 'length:', v.length);
    
    // EIP-2098 compact signature: modify the first byte of s based on v
    const firstByteOfS = parseInt(s.slice(0, 2), 16);
    const recoveryId = parseInt(v, 16) - 27; // 0 or 1
    const modifiedFirstByte = recoveryId === 1 ? firstByteOfS | 0x80 : firstByteOfS;
    const vs = '0x' + modifiedFirstByte.toString(16).padStart(2, '0') + s.slice(2);
    const takerTraits = new TakerTraits(0n, {
        receiver: new Address(takerWallet.address),
        extension: storedOrder.reconstructedOrder.extension
      })
    const {trait, args} = takerTraits.encode()
    // console.log('vs:', vs, 'length:', vs.length);

    // Add comprehensive logging for cast call construction
    
    console.log('\n=== COMPLETE CAST COMMAND ===');
    console.log(`cast call --rpc-url http://localhost:8547 \\`);
    console.log(`  ${LIMIT_ORDER_PROTOCOL_ADDRESS} \\`);
    console.log(`  "fillOrderArgs((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256),bytes32,bytes32,uint256,uint256,bytes)" \\`);
    console.log(`  "(${orderStruct.salt},${orderStruct.maker},${orderStruct.receiver},${orderStruct.makerAsset},${orderStruct.takerAsset},${orderStruct.makingAmount},${orderStruct.takingAmount},${orderStruct.makerTraits})" \\`);
    console.log(`  ${r} \\`);
    console.log(`  ${vs} \\`);
    console.log(`  ${takingAmount.toString()} \\`);
    console.log(`  ${trait} \\`);
    console.log(`  ${args} \\`);
    console.log(`  --trace \\`)
    console.log(`  --from ${takerWallet.address}`)
    console.log('================================\n');
    console.log('filling order', orderStruct);
    // await checkAndApproveLimitOrderProtocol(orderStruct.makerAsset, BigInt(orderStruct.makingAmount), makerWallet);
    // await checkAndApproveLimitOrderProtocol(orderStruct.takerAsset, takingAmount, takerWallet);
    // await checkAndApproveLimitOrderProtocol(orderStruct.takerAsset, takingAmount, makerWallet, true);
    // const tx = await contract.fillOrderArgs(
    //   orderStruct,
    //   r,
    //   vs,
    //   takingAmount,
    //   trait,
    //   args
    // );

    // const receipt = await tx.wait();
    orderStorage.delete(storedOrder.id);
    return {
      transactionHash: '0x',
      blockNumber: 0,
      gasUsed: '0'
    };
  } catch (error) {
    console.error('Error filling order:', error);
    throw error;
  }
}

async function checkAndApproveLimitOrderProtocol(
  tokenAddress: string, 
  amount: bigint, 
  wallet: ethers.Wallet,
  needSecondApprove: boolean = false
): Promise<void> {
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  
  // Check current allowance for the limit order protocol contract
//   const currentAllowance = await tokenContract.allowance(wallet.address, LIMIT_ORDER_PROTOCOL_ADDRESS);
//   console.log(`Current limit order protocol allowance for ${tokenAddress}: ${currentAllowance.toString()}`);
  
//     console.log(`Insufficient allowance, approving limit order protocol for ${tokenAddress}...`);
    
    const maxApproval = ethers.MaxUint256;
    const approveTx = await tokenContract.approve(LIMIT_ORDER_PROTOCOL_ADDRESS, maxApproval);
    
    console.log(`Approval transaction hash: ${approveTx.hash}`);
    
    // Wait for approval to be confirmed
    await approveTx.wait();
    if (needSecondApprove) {
        const secondApproveTx = await tokenContract.approve(POST_INTERACTION_ADDRESS, maxApproval);
        await secondApproveTx.wait();
    }
    // console.log(`Limit order protocol approval confirmed for ${tokenAddress}`);
}

app.post('/fill-order/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const storedOrder = orderStorage.get(id);
    
    if (!storedOrder) {
      return res.status(404).json({ error: 'Order not found' });
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

// Export for Vercel serverless function
export default app;

