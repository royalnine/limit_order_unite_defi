import { ethers, Interface } from 'ethers';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { trim0x } from '@1inch/byte-utils'

import {
  LimitOrder,
  MakerTraits,
  Address,
  ExtensionBuilder,
  Interaction
} from '@1inch/limit-order-sdk';

dotenv.config();

const chainId = 31337;
const MAKER_PRIVATE_KEY = process.env.MAKER_PRIVATE_KEY;
const TAKER_PRIVATE_KEY = process.env.TAKER_PRIVATE_KEY;
const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY;
const RESOLVER_URL = process.env.RESOLVER_URL || 'http://localhost:3001';
const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const WETH_DECIMALS = 18;
const USDT_DECIMALS = 6;
const AAVE_POOL_ADDRESS = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const MULTICALL3_ADDRESS = '0xca11bde05977b3631167028862be2a173976ca11';
const POST_INTERACTION_ADDRESS = '0x8815Ab44465734eF2C41de36cff0ab130e1ab32B';

function encodeAaveSupply(amount: bigint, trader: Address): string {
    const aavePoolAbi = [
        'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
    ];
    const poolInterface = new Interface(aavePoolAbi);

    const supplyCalldata = poolInterface.encodeFunctionData('supply', [
        WETH_ADDRESS,
        amount,
        trader.toString(),
        0
    ]);

    return supplyCalldata
}

function encodeErc20Allowance(amount: bigint, trader: Address): string {
    const erc20Abi = [
        'function approve(address spender, uint256 value)'
    ];
    const erc20Interface = new Interface(erc20Abi);
    
    const allowanceCalldata = erc20Interface.encodeFunctionData('approve', [
        AAVE_POOL_ADDRESS,
        amount
    ]);

    return allowanceCalldata
}

function encodeErc20TransferToPostInteraction(amount: bigint, trader: Address): string {
    const erc20Abi = [
        'function transferFrom(address from, address to, uint256 value)'
    ];
    const erc20Interface = new Interface(erc20Abi);
    
    const transferCalldata = erc20Interface.encodeFunctionData('transferFrom', [
        trader.toString(),
        POST_INTERACTION_ADDRESS,
        amount
    ]);

    return transferCalldata
}


function encodeCompleteMulticall(multicallData: string): string {
    return MULTICALL3_ADDRESS + trim0x(multicallData)
}

function buildMulticallInteraction(aaveAmount: bigint,  onBehalfOf: Address): Interaction {
    const multicallAbi = [
        'function aggregate3Value(tuple(address target,bool allowFailure,uint256 value,bytes callData)[] calls) returns (tuple(bool success, bytes returnData)[] returnData)'
    ];

    const multicallInterface = new Interface(multicallAbi);

    const erc20Allowance = encodeErc20Allowance(aaveAmount, onBehalfOf);
    const erc20TransferToPostInteraction = encodeErc20TransferToPostInteraction(aaveAmount, onBehalfOf);
    const supplyCalldata = encodeAaveSupply(aaveAmount, onBehalfOf);

    const multicallData = multicallInterface.encodeFunctionData('aggregate3Value', [
        [
            [WETH_ADDRESS, false, 0, erc20Allowance],
            [WETH_ADDRESS, false, 0, erc20TransferToPostInteraction],
            [AAVE_POOL_ADDRESS, false, 0, supplyCalldata]
        ]
    ]);

    const completeMulticallData = encodeCompleteMulticall(multicallData)

    return new Interaction(new Address(POST_INTERACTION_ADDRESS), completeMulticallData);
}

async function fillOrderFromResolver(orderId: string): Promise<void> {
    try {
        const response = await fetch(`${RESOLVER_URL}/fill-order/${orderId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('Order filled successfully:', result);
    } catch (error) {
        console.error('Failed to fill order:', error);
        throw error;
    }
}

async function submitOrderToResolver(order: LimitOrder, signature: string): Promise<string> {
    try {
        const orderStruct = order.build();
        
        const response = await fetch(`${RESOLVER_URL}/submit-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                order: orderStruct,
                signature,
                extension: order.extension.encode()
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json() as { orderId: string };
        console.log('Order submitted to resolver:', result);
        
        return result.orderId;
    } catch (error) {
        console.error('Failed to submit order to resolver:', error);
        throw error;
    }
}


async function main() {
    const makingAmount = BigInt(0.5 * 10 ** USDT_DECIMALS)
    const takingAmount = BigInt(0.0001 * 10 ** WETH_DECIMALS)
    
    if (!MAKER_PRIVATE_KEY || !ONEINCH_API_KEY || !TAKER_PRIVATE_KEY) {
        throw new Error('Environment variables MAKER_PRIVATE_KEY or ONEINCH_API_KEY or TAKER_PRIVATE_KEY are missing');
    }

    const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc');
    const maker = new ethers.Wallet(MAKER_PRIVATE_KEY, provider);
    const makerAddress = new Address(maker.address)
    const expiresIn = 1200n // 20m
    const expiration = BigInt(Math.floor(Date.now() / 1000)) + expiresIn

    const makerTraits = MakerTraits.default().withExpiration(expiration).allowMultipleFills().allowPartialFills().enablePostInteraction()
    const multicallInteraction = buildMulticallInteraction(takingAmount, makerAddress);
    
    const customExtension = new ExtensionBuilder().withPostInteraction(multicallInteraction).build();
    const orderWithExtension = new LimitOrder(
        {
            makerAsset: new Address(USDT_ADDRESS),
            takerAsset: new Address(WETH_ADDRESS),
            makingAmount: makingAmount,
            takingAmount: takingAmount,
            maker: makerAddress,
            receiver: makerAddress,
        }, 
        makerTraits, customExtension
    )

    const typedData = orderWithExtension.getTypedData(chainId)
    const signature = await maker.signTypedData(
        typedData.domain,
        {Order: typedData.types.Order},
        typedData.message
    )

    // Submit to custom resolver instead of 1inch API
    const orderId = await submitOrderToResolver(orderWithExtension, signature)
    
    console.log(`Order submitted with ID: ${orderId}`)
    
    // Wait a moment then fill the order
    console.log('Waiting 2 seconds before filling order...')
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    await fillOrderFromResolver(orderId)
    
    // Still get orders from 1inch API for comparison
    // const orders = await api.getOrdersByMaker(makerAddress)
    // console.log(orders)
    }

main()

// console.log("Hello World")