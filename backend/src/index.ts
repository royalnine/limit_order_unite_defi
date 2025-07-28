import { ethers, Interface } from 'ethers';
import dotenv from 'dotenv';

import {
  LimitOrder,
  MakerTraits,
  Address,
  Api,
  FetchProviderConnector,
  LimitOrderWithFee,
  Sdk,
  ExtensionBuilder,
  Interaction
} from '@1inch/limit-order-sdk';

dotenv.config();

const chainId = 42161;
const privKey = process.env.PRIVATE_KEY;
const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY;
const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const WETH_DECIMALS = 18;
const USDT_DECIMALS = 6;


// Additional protocol constants
// Aave V3 Pool address on Arbitrum One
const AAVE_POOL_ADDRESS = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
// Multicall3 canonical deployment on Arbitrum One
const MULTICALL3_ADDRESS = '0xca11bde05977b3631167028862be2a173976ca11';


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

    return supplyCalldata
}

// function encodeMorphoSupply(amount: bigint, trader: Address): string {
//     // Morpho Blue uses supplyCollateral to deposit the collateralToken into a market.
//     // We encode the call with a tuple representing MarketParams and other required arguments.
//     const morphoAbi = [
//         'function supplyCollateral((address,address,address,address,uint256) marketParams, uint256 assets, address onBehalf, bytes data)'
//     ];
//     const poolInterface = new Interface(morphoAbi);

//     // TODO: replace the following placeholder addresses with real market parameters
//     const marketParams = [
//         USDT_ADDRESS,          // loanToken – asset that will be borrowed against
//         WETH_ADDRESS,          // collateralToken – asset being supplied
//         ethers.ZeroAddress,    // oracle (placeholder)
//         ethers.ZeroAddress,    // interest rate model (placeholder)
//         0n                     // lltv (placeholder)
//     ];

//     const collateralCalldata = poolInterface.encodeFunctionData('supplyCollateral', [
//         marketParams,
//         amount,
//         trader.toString(),
//         '0x'                   // empty bytes data
//     ]);

//     return collateralCalldata;
// }


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


async function main() {
    const makingAmount = BigInt(0.5 * 10 ** USDT_DECIMALS)
    const takingAmount = BigInt(0.0001 * 10 ** WETH_DECIMALS)
    
    if (!privKey || !ONEINCH_API_KEY) {
        throw new Error('Environment variables PRIVATE_KEY or ONEINCH_API_KEY are missing');
    }

    const provider = new ethers.JsonRpcProvider(process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc');
    const maker = new ethers.Wallet(privKey, provider);

    const makerAddress = new Address(maker.address)
    const expiresIn = 120n // 2m
    const expiration = BigInt(Math.floor(Date.now() / 1000)) + expiresIn

    // see MakerTraits.ts
    const makerTraits = MakerTraits.default().withExpiration(expiration).allowMultipleFills().allowPartialFills().enablePermit2().enablePostInteraction()

    const sdk = new Sdk({ authKey: ONEINCH_API_KEY!, networkId: chainId, httpConnector: new FetchProviderConnector() })

    const api = new Api({
        networkId: chainId,
        authKey: ONEINCH_API_KEY!,
        httpConnector:  new FetchProviderConnector()
    })

    const order = await sdk.createOrder({
        makerAsset: new Address(USDT_ADDRESS),
        takerAsset: new Address(WETH_ADDRESS),
        makingAmount: makingAmount, // 0.0001 WETH
        takingAmount: takingAmount, // 0.5 USDT
        maker: makerAddress,
        receiver: makerAddress,
    }, makerTraits)

    // Attach the post-interaction that supplies the received USDT into Aave via Multicall3
    const multicallInteraction = buildMulticallInteraction(makingAmount, makerAddress);
    const feeParams = await api.getFeeParams({
        makerAsset: new Address(USDT_ADDRESS),
        takerAsset: new Address(WETH_ADDRESS),
        makerAmount: makingAmount,
        takerAmount: takingAmount
    })
    
    const customExtension = new ExtensionBuilder().withPostInteraction(multicallInteraction).build();

    const extension = order.extension
    const builtOrder = order.build();
    // const reconstructedOrder = LimitOrder.fromDataAndExtension(builtOrder, customExtension);
    const orderWithExtension = new LimitOrder(
        {
            makerAsset: new Address(USDT_ADDRESS),
            takerAsset: new Address(WETH_ADDRESS),
            makingAmount: makingAmount, // 0.0001 WETH
            takingAmount: takingAmount, // 0.5 USDT
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

    

    await api.submitOrder(orderWithExtension, signature)
    const orders = await api.getOrdersByMaker(makerAddress)
        console.log(orders)
    }

main()

// console.log("Hello World")