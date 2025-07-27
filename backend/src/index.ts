import { ethers } from 'ethers';
import dotenv from 'dotenv';

import {
  LimitOrder,
  MakerTraits,
  Address,
  Api,
  FetchProviderConnector,
  LimitOrderWithFee,
  Sdk
} from '@1inch/limit-order-sdk';

dotenv.config();

const chainId = 42161;
const privKey = process.env.PRIVATE_KEY;
const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY;
const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const WETH_DECIMALS = 18;
const USDT_DECIMALS = 6;

async function main() {
    
    if (!privKey || !ONEINCH_API_KEY) {
        throw new Error('Environment variables PRIVATE_KEY or ONEINCH_API_KEY are missing');
    }

    const maker = new ethers.Wallet(privKey);
    const makerAddress = new Address(maker.address)
    const expiresIn = 120n // 2m
    const expiration = BigInt(Math.floor(Date.now() / 1000)) + expiresIn

    // see MakerTraits.ts
    const makerTraits = MakerTraits.default().withExpiration(expiration).allowMultipleFills().allowPartialFills()

    const sdk = new Sdk({ authKey: ONEINCH_API_KEY!, networkId: chainId, httpConnector: new FetchProviderConnector() })

    const order = await sdk.createOrder({
        makerAsset: new Address(WETH_ADDRESS),
        takerAsset: new Address(USDT_ADDRESS),
        makingAmount: BigInt(0.0001 * 10 ** WETH_DECIMALS), // 0.0001 WETH
        takingAmount: BigInt(0.5 * 10 ** USDT_DECIMALS), // 0.5 USDT
        maker: makerAddress,
        receiver: makerAddress,
    }, makerTraits)

    const builtOrder = order.build()
    const extension = order.extension

    const reconstructedOrder = LimitOrderWithFee.fromDataAndExtension(builtOrder, extension)

    const typedData = reconstructedOrder.getTypedData(chainId)
    const signature = await maker.signTypedData(
        typedData.domain,
        {Order: typedData.types.Order},
        typedData.message
    )

    const api = new Api({
        networkId: chainId,
        authKey: ONEINCH_API_KEY!,
        httpConnector:  new FetchProviderConnector()
    })

    await api.submitOrder(reconstructedOrder, signature)
    const orders = await api.getOrdersByMaker(makerAddress)
        console.log(orders)
    }

main()

// console.log("Hello World")