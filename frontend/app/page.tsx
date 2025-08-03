'use client';

import { useState, useEffect, useRef } from 'react';
import { CompassApiSDK } from '@compass-labs/api-sdk';
import { AaveUserPositionPerTokenToken } from '@compass-labs/api-sdk/models/operations';
import { ethers, Interface } from 'ethers';
import { trim0x } from '@1inch/byte-utils';
import {
  LimitOrder,
  MakerTraits,
  Address,
  ExtensionBuilder,
  Interaction
} from '@1inch/limit-order-sdk';
import { useAccount, useChainId, useConnect, useSwitchChain, useWalletClient } from 'wagmi';


const sdk = new CompassApiSDK({
    apiKeyAuth: process.env.NEXT_PUBLIC_COMPASS_API_KEY,
});

// Constants for limit order creation (similar to backend)
// const chainId = 31337; // Remove this line
const RESOLVER_URL = process.env.NEXT_PUBLIC_RESOLVER_URL;
const AAVE_POOL_ADDRESS = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const MULTICALL3_ADDRESS = '0xca11bde05977b3631167028862be2a173976ca11';
const POST_INTERACTION_ADDRESS = '0x8815Ab44465734eF2C41de36cff0ab130e1ab32B';
const LIMIT_ORDER_PROTOCOL_ADDRESS = '0x111111125421cA6dc452d289314280a0f8842A65';
const ONEINCH_API_KEY = process.env.NEXT_PUBLIC_ONEINCH_API_KEY;
// ERC20 ABI for allowance and approval calls
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

// Define types for AAVE data structures
interface AaveAccountSummary { 
    maximumLoanToValueRatio: string;
    healthFactor: string;
    totalCollateral: string;
    totalDebt: string;
    availableBorrows: string;
    liquidationThreshold: string;
}

interface AaveSupportedToken {
    symbol: string;
    address: string;
    supplyingEnabled: boolean;
    borrowingEnabled: boolean;
}

interface AaveSupportedTokensResponse {
    tokens: AaveSupportedToken[];
}

interface AaveTokenPosition {
    symbol: string;
    address: string;
    tokenBalance: string;
    stableDebt: string;
    variableDebt: string;
    principalStableDebt: string;
    principalVariableDebt: string;
    stableBorrowRate: string;
    stableBorrowRateForNewLoans: string;
    variableBorrowRate: string;
    liquidityRate: string;
}

function encodeAaveSupply(amount: bigint, trader: Address, supplyTokenAddress: string): string {
    const aavePoolAbi = [
        'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
    ];
    const poolInterface = new Interface(aavePoolAbi);

    const supplyCalldata = poolInterface.encodeFunctionData('supply', [
        supplyTokenAddress,
        amount,
        trader.toString(),
        0
    ]);

    return supplyCalldata;
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

function encodeErc20Allowance(amount: bigint, trader: Address, tokenAddress: string): string {
    const erc20Abi = [
        'function approve(address spender, uint256 value)'
    ];
    const erc20Interface = new Interface(erc20Abi);
    
    const allowanceCalldata = erc20Interface.encodeFunctionData('approve', [
        AAVE_POOL_ADDRESS,
        amount
    ]);

    return allowanceCalldata;
}

function encodeErc20TransferToPostInteraction(amount: bigint, trader: Address, tokenAddress: string): string {
    const erc20Abi = [
        'function transferFrom(address from, address to, uint256 value)'
    ];
    const erc20Interface = new Interface(erc20Abi);
    
    const transferCalldata = erc20Interface.encodeFunctionData('transferFrom', [
        trader.toString(),
        POST_INTERACTION_ADDRESS,
        amount
    ]);

    return transferCalldata;
}

function encodeCompleteMulticall(multicallData: string): string {
    return MULTICALL3_ADDRESS + trim0x(multicallData);
}

function buildMulticallInteraction(supplyAmount: bigint, onBehalfOf: Address, supplyTokenAddress: string): Interaction {
    const multicallAbi = [
        'function aggregate3Value(tuple(address target,bool allowFailure,uint256 value,bytes callData)[] calls) returns (tuple(bool success, bytes returnData)[] returnData)'
    ];

    const multicallInterface = new Interface(multicallAbi);

    const erc20Allowance = encodeErc20Allowance(supplyAmount, onBehalfOf, supplyTokenAddress);
    const erc20TransferToPostInteraction = encodeErc20TransferToPostInteraction(supplyAmount, onBehalfOf, supplyTokenAddress);
    const supplyCalldata = encodeAaveSupply(supplyAmount, onBehalfOf, supplyTokenAddress);

    const multicallData = multicallInterface.encodeFunctionData('aggregate3Value', [
        [
            [supplyTokenAddress, false, 0, erc20Allowance],
            [supplyTokenAddress, false, 0, erc20TransferToPostInteraction],
            [AAVE_POOL_ADDRESS, false, 0, supplyCalldata]
        ]
    ]);

    const completeMulticallData = encodeCompleteMulticall(multicallData);

    return new Interaction(new Address(POST_INTERACTION_ADDRESS), completeMulticallData);
}

// Allowance checking and approval functions
async function checkAndApproveLimitOrderProtocol(
  tokenAddress: string, 
  amount: bigint, 
  signer: ethers.Signer,
  needSecondApprove: boolean = false
): Promise<void> {
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const userAddress = await signer.getAddress();
  
  // Check current allowance for the limit order protocol contract
  const currentAllowance = await tokenContract.allowance(userAddress, LIMIT_ORDER_PROTOCOL_ADDRESS);
  console.log(`Current limit order protocol allowance for ${tokenAddress}: ${currentAllowance.toString()}`);
  
  if (amount > currentAllowance) {
    const maxApproval = ethers.MaxUint256;
    console.log(`Insufficient allowance, approving limit order protocol for ${tokenAddress}...`);
    const approveTx = await tokenContract.approve(LIMIT_ORDER_PROTOCOL_ADDRESS, maxApproval);
    console.log(`Approval transaction hash: ${approveTx.hash}`);
    const receipt = await approveTx.wait();
    console.log(`Approval confirmed in block ${receipt.blockNumber}`);
  }
  
  if (needSecondApprove) {
    const currentAllowancePost = await tokenContract.allowance(userAddress, POST_INTERACTION_ADDRESS);
    console.log(`Current post interaction allowance for ${tokenAddress}: ${currentAllowancePost.toString()}`);
    if (amount > currentAllowancePost) {
      const maxApproval = ethers.MaxUint256;
      const secondApproveTx = await tokenContract.approve(POST_INTERACTION_ADDRESS, maxApproval);
      console.log(`Second approval transaction hash: ${secondApproveTx.hash}`);
      const receipt = await secondApproveTx.wait();
      console.log(`Second approval confirmed in block ${receipt.blockNumber}`);
    }
  }
  console.log(`Limit order protocol approval confirmed for ${tokenAddress}`);
}

async function submitOrderToResolver(order: LimitOrder, signature: string, isLong: boolean, limitPriceUsd: number): Promise<string> {
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
                extension: order.extension.encode(),
                isLong: isLong,
                limitPriceUsd: limitPriceUsd
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

export default function Page() {
    const targetChainId = 8453;
    const { address: userAddress, isConnected: walletConnected } = useAccount();
    const { connect, connectors, isPending: isConnecting } = useConnect();
    const { data: walletClient } = useWalletClient({ chainId: targetChainId });
    
    const [accountSummary, setAccountSummary] = useState<AaveAccountSummary | null>(null);
    const [tokenPositions, setTokenPositions] = useState<AaveTokenPosition[]>([]);
    const [supportedTokens, setSupportedTokens] = useState<AaveSupportedTokensResponse>();
    const [selectedPosition, setSelectedPosition] = useState<AaveTokenPosition | null>(null);
    const [selectedSupplyPosition, setSelectedSupplyPosition] = useState<AaveTokenPosition | null>(null);
    const [selectedBorrowPosition, setSelectedBorrowPosition] = useState<AaveTokenPosition | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [limitPrice, setLimitPrice] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Fillable orders polling state
    const [fillableOrders, setFillableOrders] = useState<any[]>([]);
    const [isPollingFillableOrders, setIsPollingFillableOrders] = useState(false);
    const [lastFillableOrdersPoll, setLastFillableOrdersPoll] = useState<Date | null>(null);
    const [orderSpotPrices, setOrderSpotPrices] = useState<{[orderId: string]: {makerTokenPrice: number, takerTokenPrice: number}}>({});
    const fillableOrdersPollingRef = useRef<NodeJS.Timeout | null>(null);
    
    // Fill order state
    const [fillingOrderId, setFillingOrderId] = useState<string | null>(null);

    // const currentChainId = useChainId();
    // console.log('currentChainId', currentChainId);
    // const { switchChain } = useSwitchChain();
    

    // Remove this auto-switching logic from here - it causes infinite loops
    // if (currentChainId !== targetChainId) {
    //     console.log(`Switching from chain ${currentChainId} to ${targetChainId}`);
    //     switchChain({ chainId: targetChainId });
    // }

    const getSupplyPositions = () => {
        return tokenPositions.filter(position => parseFloat(position.tokenBalance) > 0);
    };

    const getBorrowPositions = () => {
        return tokenPositions.filter(position => 
            parseFloat(position.variableDebt) > 0 || parseFloat(position.stableDebt) > 0
        );
    };

    const loadAaveData = async (userAddress: string) => {
                
        setIsLoading(true);
        
        try {
            console.log('Loading AAVE data for address:', userAddress);
            
            const summaryResponse = await sdk.aaveV3.userPositionSummary({
                chain: 'base:mainnet',
                user: userAddress,
            });
            
            if (summaryResponse) {
                setAccountSummary(summaryResponse);
                console.log('Account summary:', summaryResponse);
            }
            
            const tokensResponse = await sdk.aaveV3.aaveSupportedTokens({
                chain: 'base:mainnet',
            });
            
            if (tokensResponse) {
                setSupportedTokens(tokensResponse);
                console.log('Supported tokens:', tokensResponse);
                
                // Fetch all token positions in parallel
                const positionPromises = tokensResponse.tokens.map(async (token) => {
                    try {
                        const positionResponse = await sdk.aaveV3.userPositionPerToken({
                            chain: 'base:mainnet',
                            user: userAddress,
                            token: token.symbol as AaveUserPositionPerTokenToken,
                        });
                        
                        if (positionResponse) {
                            const hasBalance = parseFloat(positionResponse.tokenBalance) > 0;
                            const hasDebt = parseFloat(positionResponse.stableDebt) > 0 || 
                                          parseFloat(positionResponse.variableDebt) > 0;
                            
                            if (hasBalance || hasDebt) {
                                return {
                                    ...positionResponse,
                                    symbol: token.symbol,
                                    address: token.address,
                                };
                            }
                        }
                        return null;
                    } catch (error) {
                        console.warn(`Failed to fetch position for token ${token.symbol}:`, error);
                        return null;
                    }
                });
                
                const positionResults = await Promise.all(positionPromises);
                const tokenPositions = positionResults.filter((position): position is AaveTokenPosition => position !== null);
                
                setTokenPositions(tokenPositions);
                console.log('Token positions:', tokenPositions);
            }
            
        } catch (error) {
            console.error('Error loading AAVE data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const connectWallet = async () => {
        try {
            const injectedConnector = connectors.find(c => c.id === 'injected');
            if (injectedConnector) {
                connect({ connector: injectedConnector });
            } else {
                alert('No wallet connector found. Please install MetaMask or another compatible wallet.');
            }
        } catch (error: any) {
            console.error('Failed to connect wallet:', error);
            alert('Failed to connect wallet. Please try again.');
        }
    };

    // Poll spot prices for orders
    const pollOrderSpotPrices = async (orders: any[]) => {
        if (orders.length === 0) return;
        
        try {
            const pricePromises = orders.map(async (order) => {
                try {
                    const prices = await getSpotPrices(order.order.makerAsset, order.order.takerAsset);
                    return { orderId: order.id, prices };
                } catch (error) {
                    console.warn(`Failed to fetch prices for order ${order.id}:`, error);
                    return null;
                }
            });
            
            const priceResults = await Promise.all(pricePromises);
            const newPrices: {[orderId: string]: {makerTokenPrice: number, takerTokenPrice: number}} = {};
            
            priceResults.forEach(result => {
                if (result) {
                    newPrices[result.orderId] = result.prices;
                }
            });
            
            setOrderSpotPrices(newPrices);
            console.log('Updated spot prices:', newPrices);
        } catch (error) {
            console.error('Error polling spot prices:', error);
        }
    };

    // Poll fillable orders
    const pollFillableOrders = async () => {
        try {
            const response = await fetch(`${RESOLVER_URL}/fillable-orders`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            setFillableOrders(data);
            setLastFillableOrdersPoll(new Date());
            console.log('Fillable orders:', data);
            
            // Fetch spot prices for all orders
            // await pollOrderSpotPrices(data);
        } catch (error) {
            console.error('Error polling fillable orders:', error);
        }
    };

    // Start polling fillable orders
    const startPollingFillableOrders = () => {
        if (isPollingFillableOrders) return;
        
        setIsPollingFillableOrders(true);
        console.log('Starting fillable orders polling...');
        
        // Initial poll
        pollFillableOrders();
        
        // Set up interval (5 seconds)
        fillableOrdersPollingRef.current = setInterval(() => {
            pollFillableOrders();
        }, 5000);
    };

    // Stop polling fillable orders
    const stopPollingFillableOrders = () => {
        if (fillableOrdersPollingRef.current) {
            clearInterval(fillableOrdersPollingRef.current);
            fillableOrdersPollingRef.current = null;
        }
        setIsPollingFillableOrders(false);
        console.log('Fillable orders polling stopped');
    };

    // Fill order function
    const fillOrder = async (orderId: string) => {
        if (!walletClient) {
            alert('Please connect your wallet first');
            return;
        }

        setFillingOrderId(orderId);
        
        try {
            console.log(`Filling order: ${orderId}`);
            
            const response = await fetch(`${RESOLVER_URL}/fill-order/${orderId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log('Order filled successfully:', result);
            alert(`Order filled successfully! Transaction: ${result.transaction.transactionHash}`);
            
            // Refresh fillable orders after successful fill
            pollFillableOrders();
            
        } catch (error) {
            console.error('Error filling order:', error);
            alert(`Failed to fill order: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setFillingOrderId(null);
        }
    };

    useEffect(() => {
        if (walletConnected && userAddress) {
            loadAaveData(userAddress);
            console.log('Wallet connected:', userAddress);
            
            // Start polling fillable orders when wallet connects
            startPollingFillableOrders();
        } else {
            // Stop polling when wallet disconnects
            stopPollingFillableOrders();
        }

        // Cleanup on unmount
        return () => {
            stopPollingFillableOrders();
        };
    }, [walletConnected, userAddress]);

    // Function to get decimals from ERC20 contract
    const getTokenDecimals = async (tokenAddress: string, provider: ethers.BrowserProvider): Promise<number> => {
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        return await contract.decimals();
    };

    const submitLimitOrder = async () => {
        setIsSubmitting(true);
        if (!selectedSupplyPosition || !selectedBorrowPosition || !limitPrice || !userAddress) return;

        try {
            if (!walletClient) {
                throw new Error('Wallet not connected');
            }

            const provider = new ethers.BrowserProvider(walletClient);
            const signer = await provider.getSigner();
            const makerAddress = new Address(userAddress);

            const borrowDebt = parseFloat(selectedBorrowPosition.variableDebt) + parseFloat(selectedBorrowPosition.stableDebt);
            
            // Get decimals from the ERC20 contracts
            const borrowTokenDecimals = await getTokenDecimals(selectedBorrowPosition.address, provider);
            const supplyTokenDecimals = await getTokenDecimals(selectedSupplyPosition.address, provider);
            
            const makingAmount = BigInt(Math.floor(borrowDebt * 10 ** borrowTokenDecimals));
            
            const takingAmount = BigInt(Math.floor(borrowDebt * 10 ** supplyTokenDecimals / parseFloat(limitPrice)));

            await checkAndApproveLimitOrderProtocol(selectedBorrowPosition.address, makingAmount, signer);
        
            await checkAndApproveLimitOrderProtocol(selectedSupplyPosition.address, takingAmount, signer, true);

            console.log('Order parameters:', {
                makingAmount: makingAmount.toString(),
                takingAmount: takingAmount.toString(),
                makerAsset: selectedBorrowPosition.address,
                takerAsset: selectedSupplyPosition.address,
                maker: makerAddress.toString(),
                limitPrice: limitPrice
            });

            const expiresIn = BigInt(1200);
            const expiration = BigInt(Math.floor(Date.now() / 1000)) + expiresIn;

            const makerTraits = MakerTraits.default()
                .withExpiration(expiration)
                .allowMultipleFills()
                .allowPartialFills()
                .enablePostInteraction();

            const multicallInteraction = buildMulticallInteraction(
                takingAmount, 
                makerAddress, 
                selectedSupplyPosition.address
            );
            
            const customExtension = new ExtensionBuilder()
                .withPostInteraction(multicallInteraction)
                .build();

            const orderWithExtension = new LimitOrder(
                {
                    makerAsset: new Address(selectedBorrowPosition.address),
                    takerAsset: new Address(selectedSupplyPosition.address),
                    makingAmount: makingAmount,
                    takingAmount: takingAmount,
                    maker: makerAddress,
                    receiver: makerAddress,
                }, 
                makerTraits, 
                customExtension
            );

            const typedData = orderWithExtension.getTypedData(targetChainId);
            console.log('Signing with chain ID:', targetChainId);
            console.log('TypedData domain:', typedData.domain);
            
            const signature = await signer.signTypedData(
                typedData.domain,
                { Order: typedData.types.Order },
                typedData.message
            );

            console.log('Order signed, submitting to resolver...');
            const isLong = false;
            const limitPriceUsd = parseFloat(limitPrice);

            const orderId = await submitOrderToResolver(orderWithExtension, signature, isLong, limitPriceUsd);
            
            console.log(`Order submitted with ID: ${orderId}`);
            alert(`Liquidation protection set up successfully! Order ID: ${orderId}`);
            
            setLimitPrice('');
            setSelectedSupplyPosition(null);
            setSelectedBorrowPosition(null);

        } catch (error) {
            console.error('Error setting up liquidation protection:', error);
            
            if (error instanceof Error) {
                if (error.message.includes('User rejected')) {
                    alert('Transaction was rejected by user');
                } else if (error.message.includes('chainId')) {
                    alert(`Chain mismatch error: ${error.message}\n\nPlease make sure your wallet is connected to the local network (Chain ID: 31337)`);
                } else {
                    alert(`Failed to set up liquidation protection: ${error.message}`);
                }
            } else {
                alert('Failed to set up liquidation protection');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
            {/* Header */}
            <header className="border-b border-purple-800/30 bg-black/20 backdrop-blur-sm">
                <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg"></div>
                        <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                            AAVE Liquidation Protection
                        </h1>
                    </div>

                    {!walletConnected ? (
                        <button
                            onClick={connectWallet}
                            disabled={isConnecting}
                            className="px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-medium hover:from-purple-700 hover:to-pink-700 transition-all duration-200 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
                        </button>
                    ) : (
                        <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                            <span className="text-sm text-gray-300">
                                {userAddress ? `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}` : 'Wallet Connected'}
                            </span>
                        </div>
                    )}
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                {/* Wallet Connection Section */}
                {!walletConnected ? (
                    <div className="text-center py-20">
                        <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full mx-auto mb-6 flex items-center justify-center">
                            <svg
                                className="w-8 h-8"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                                />
                            </svg>
                        </div>
                        <h2 className="text-3xl font-bold mb-4">Protect Your AAVE Positions</h2>
                        <p className="text-gray-400 max-w-md mx-auto mb-8">
                            Set limit orders using 1inch protocol to automatically protect your
                            positions from liquidation
                        </p>
                        <button
                            onClick={connectWallet}
                            disabled={isConnecting}
                            className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-medium hover:from-purple-700 hover:to-pink-700 transition-all duration-200 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isConnecting ? 'Connecting...' : 'Connect Wallet to Get Started'}
                        </button>
                    </div>
                ) : (
                    <div className="grid lg:grid-cols-3 gap-8">
                        {/* Fillable Orders */}
                        <div className="bg-black/30 backdrop-blur-sm rounded-xl border border-purple-800/30 p-6">
                            <h2 className="text-xl font-bold mb-6 flex items-center">
                                <svg
                                    className="w-5 h-5 mr-2 text-blue-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                                    />
                                </svg>
                                Fillable Orders
                            </h2>
                            
                            <div className="mb-4 flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <div className={`w-2 h-2 rounded-full ${isPollingFillableOrders ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`}></div>
                                    <span className="text-sm text-gray-300">
                                        {isPollingFillableOrders ? 'Polling every 5s' : 'Stopped'}
                                    </span>
                                </div>
                                {lastFillableOrdersPoll && (
                                    <span className="text-xs text-gray-500">
                                        Last: {lastFillableOrdersPoll.toLocaleTimeString()}
                                    </span>
                                )}
                            </div>

                            <div className="space-y-3">
                                {fillableOrders.length > 0 ? (
                                    fillableOrders.map((order, index) => (
                                        <div key={index} className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
                                            <div className="flex justify-between items-start mb-2">
                                                <span className="text-sm font-medium text-blue-400">Order {index + 1}</span>
                                                <span className="text-xs text-gray-500">
                                                    {new Date(order.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-300 space-y-1">
                                                <div>ID: {order.id.slice(0, 10)}...</div>
                                                <div>Maker: {order.order.maker.slice(0, 6)}...{order.order.maker.slice(-4)}</div>
                                                <div>Making: {order.order.makingAmount}</div>
                                                <div>Taking: {order.order.takingAmount}</div>
                                                <div>Limit Price: {order.limitPriceUsd}</div>
                                                {/* <div>Expiration: {new MakerTraits(order.order.makerTraits).expiration()}</div> */}
                                            </div>
                                            <div className="mt-3 flex justify-end">
                                                <button
                                                    onClick={() => fillOrder(order.id)}
                                                    disabled={fillingOrderId === order.id}
                                                    className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                                                        fillingOrderId === order.id
                                                            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                                            : 'bg-green-600 hover:bg-green-700 text-white'
                                                    }`}
                                                >
                                                    {fillingOrderId === order.id ? (
                                                        <div className="flex items-center">
                                                            <div className="animate-spin rounded-full h-3 w-3 border-b border-white mr-1"></div>
                                                            Filling...
                                                        </div>
                                                    ) : (
                                                        'Fill Order'
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-center py-8">
                                        <p className="text-gray-400">No fillable orders found</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* AAVE Positions */}
                        <div className="bg-black/30 backdrop-blur-sm rounded-xl border border-purple-800/30 p-6">
                            <h2 className="text-xl font-bold mb-6 flex items-center">
                                <svg
                                    className="w-5 h-5 mr-2 text-purple-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                                    />
                                </svg>
                                Your AAVE Positions
                            </h2>

                            {isLoading ? (
                                <div className="text-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-4"></div>
                                    <p className="text-gray-400">Loading AAVE data...</p>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {/* Account Summary */}
                                    {accountSummary && (
                                        <div className="p-4 rounded-lg border border-gray-700 bg-gray-800/50">
                                            <h3 className="font-semibold text-lg mb-4 flex items-center">
                                                <svg className="w-4 h-4 mr-2 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                                </svg>
                                                Account Summary
                                            </h3>
                                            <div className="grid grid-cols-2 gap-4 mb-4">
                                                <div>
                                                                                        <p className="text-gray-400 text-sm">Total Collateral</p>
                                    <p className="font-medium">{parseFloat(accountSummary.totalCollateral).toFixed(6)}</p>
                                                </div>
                                                <div>
                                                                                        <p className="text-gray-400 text-sm">Total Debt</p>
                                    <p className="font-medium">{parseFloat(accountSummary.totalDebt).toFixed(6)}</p>
                                                </div>
                                                <div>
                                                                                        <p className="text-gray-400 text-sm">Available Borrows</p>
                                    <p className="font-medium">{parseFloat(accountSummary.availableBorrows).toFixed(6)}</p>
                                                </div>
                                                <div>
                                                                                        <p className="text-gray-400 text-sm">Max LTV</p>
                                    <p className="font-medium">{(parseFloat(accountSummary.maximumLoanToValueRatio) * 100).toFixed(2)}%</p>
                                                </div>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-400 text-sm">Account Health Factor</span>
                                                <div
                                                    className={`px-3 py-1 rounded text-sm font-medium ${
                                                        parseFloat(accountSummary.healthFactor) > 1.5
                                                            ? 'bg-green-500/20 text-green-400'
                                                            : parseFloat(accountSummary.healthFactor) > 1.2
                                                              ? 'bg-yellow-500/20 text-yellow-400'
                                                              : 'bg-red-500/20 text-red-400'
                                                    }`}
                                                >
                                                    {parseFloat(accountSummary.healthFactor).toFixed(3)}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Supply Positions */}
                                    {getSupplyPositions().length > 0 && (
                                        <div className="space-y-4">
                                            <h3 className="font-semibold text-lg flex items-center">
                                                <svg className="w-5 h-5 mr-2 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                                                </svg>
                                                Supply Positions (Collateral)
                                            </h3>
                                            {getSupplyPositions().map((position) => (
                                                <div
                                                    key={`supply-${position.address}`}
                                                    className={`p-4 rounded-lg border cursor-pointer transition-all duration-200 ${
                                                        selectedSupplyPosition?.address === position.address
                                                            ? 'border-green-500 bg-green-500/10'
                                                            : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                                                    }`}
                                                    onClick={() => setSelectedSupplyPosition(position)}
                                                >
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div>
                                                            <h4 className="font-semibold text-lg flex items-center">
                                                                {position.symbol}
                                                                <span className="ml-2 px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded">
                                                                    SUPPLY
                                                                </span>
                                                            </h4>
                                                            <p className="text-sm text-gray-400">
                                                                Supplied: {(parseFloat(position.tokenBalance)).toFixed(6)} {position.symbol}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                                        <div>
                                                            <p className="text-gray-400">Liquidity Rate (APY)</p>
                                                            <p className="font-medium text-green-400">
                                                                {(parseFloat(position.liquidityRate) * 100).toFixed(2)}%
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Borrow Positions */}
                                    {getBorrowPositions().length > 0 && (
                                        <div className="space-y-4">
                                            <h3 className="font-semibold text-lg flex items-center">
                                                <svg className="w-5 h-5 mr-2 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                Borrow Positions (Debt)
                                            </h3>
                                            {getBorrowPositions().map((position) => (
                                                <div
                                                    key={`borrow-${position.address}`}
                                                    className={`p-4 rounded-lg border cursor-pointer transition-all duration-200 ${
                                                        selectedBorrowPosition?.address === position.address
                                                            ? 'border-red-500 bg-red-500/10'
                                                            : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                                                    }`}
                                                    onClick={() => setSelectedBorrowPosition(position)}
                                                >
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div>
                                                            <h4 className="font-semibold text-lg flex items-center">
                                                                {position.symbol}
                                                                <span className="ml-2 px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded">
                                                                    BORROW
                                                                </span>
                                                            </h4>
                                                            <p className="text-sm text-gray-400">
                                                                Total Debt: {((parseFloat(position.variableDebt) + parseFloat(position.stableDebt))).toFixed(6)} {position.symbol}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                                        <div>
                                                            <p className="text-gray-400">Variable Debt</p>
                                                            <p className="font-medium">
                                                                {(parseFloat(position.variableDebt)).toFixed(6)} {position.symbol}
                                                            </p>
                                                        </div>
                                                        <div>
                                                            <p className="text-gray-400">Variable Rate (APY)</p>
                                                            <p className="font-medium text-red-400">
                                                                {(parseFloat(position.variableBorrowRate) * 100).toFixed(2)}%
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* No positions message */}
                                    {tokenPositions.length === 0 && (
                                        <div className="text-center py-8">
                                            <p className="text-gray-400">No active positions found</p>
                                        </div>
                                    )}

                                    {/* No supply/borrow positions message */}
                                    {tokenPositions.length > 0 && getSupplyPositions().length === 0 && getBorrowPositions().length === 0 && (
                                        <div className="text-center py-8">
                                            <p className="text-gray-400">No supply or borrow positions found</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Limit Order Form */}
                        <div className="bg-black/30 backdrop-blur-sm rounded-xl border border-purple-800/30 p-6">
                            <h2 className="text-xl font-bold mb-6 flex items-center">
                                <svg
                                    className="w-5 h-5 mr-2 text-pink-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                                    />
                                </svg>
                                Set Liquidation Protection
                            </h2>

                            {!selectedSupplyPosition || !selectedBorrowPosition ? (
                                <div className="text-center py-12">
                                    <div className="w-12 h-12 bg-gray-700 rounded-full mx-auto mb-4 flex items-center justify-center">
                                        <svg
                                            className="w-6 h-6 text-gray-400"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                                            />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg font-semibold mb-3 text-gray-200">
                                        Select Positions for Protection
                                    </h3>
                                    <div className="space-y-3">
                                        <p className="text-gray-400 text-sm max-w-md mx-auto">
                                            To set up liquidation protection, you need to select both:
                                        </p>
                                        <div className="flex flex-col space-y-2 max-w-sm mx-auto">
                                            <div className={`flex items-center justify-between p-3 rounded-lg border ${
                                                selectedSupplyPosition 
                                                    ? 'border-green-500 bg-green-500/10' 
                                                    : 'border-gray-600 bg-gray-800/30'
                                            }`}>
                                                <div className="flex items-center">
                                                    <svg className="w-4 h-4 mr-2 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                                                    </svg>
                                                    <span className="text-sm">1 Supply Position</span>
                                                </div>
                                                {selectedSupplyPosition ? (
                                                    <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                ) : (
                                                    <div className="w-4 h-4 border border-gray-500 rounded"></div>
                                                )}
                                            </div>
                                            <div className={`flex items-center justify-between p-3 rounded-lg border ${
                                                selectedBorrowPosition 
                                                    ? 'border-red-500 bg-red-500/10' 
                                                    : 'border-gray-600 bg-gray-800/30'
                                            }`}>
                                                <div className="flex items-center">
                                                    <svg className="w-4 h-4 mr-2 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    <span className="text-sm">1 Borrow Position</span>
                                                </div>
                                                {selectedBorrowPosition ? (
                                                    <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                ) : (
                                                    <div className="w-4 h-4 border border-gray-500 rounded"></div>
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-gray-500 text-xs mt-4">
                                            The protection strategy will monitor both positions and trigger automatic actions when liquidation risk increases.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 gap-4">
                                        {/* Selected Supply Position */}
                                        <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                                            <div className="flex justify-between items-start mb-2">
                                                <h3 className="font-semibold text-green-400 flex items-center">
                                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                                                    </svg>
                                                    Supply Position: {selectedSupplyPosition.symbol}
                                                </h3>
                                                <button
                                                    onClick={() => setSelectedSupplyPosition(null)}
                                                    className="text-gray-400 hover:text-white transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                            <div className="text-sm text-gray-300">
                                                <p>Supplied: {parseFloat(selectedSupplyPosition.tokenBalance).toFixed(6)} {selectedSupplyPosition.symbol}</p>
                                            </div>
                                        </div>

                                        {/* Selected Borrow Position */}
                                        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                                            <div className="flex justify-between items-start mb-2">
                                                <h3 className="font-semibold text-red-400 flex items-center">
                                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    Borrow Position: {selectedBorrowPosition.symbol}
                                                </h3>
                                                <button
                                                    onClick={() => setSelectedBorrowPosition(null)}
                                                    className="text-gray-400 hover:text-white transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                                </div>
                                        <div className="text-sm text-gray-300">
                                                <p>Total Debt: {(parseFloat(selectedBorrowPosition.variableDebt) + parseFloat(selectedBorrowPosition.stableDebt)).toFixed(6)} {selectedBorrowPosition.symbol}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-2">
                                            Limit Price (USD)
                                        </label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={limitPrice}
                                                onChange={(e) => setLimitPrice(e.target.value)}
                                                placeholder="Enter trigger price"
                                                className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg focus:border-purple-500 focus:outline-none transition-colors"
                                                step="0.01"
                                            />

                                            <div className="absolute right-3 top-3 text-gray-400 text-sm">
                                                USD
                                            </div>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-2">
                                            Order will execute when {selectedSupplyPosition.symbol} price reaches this level
                                        </p>
                                    </div>

                                    <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                                        <h4 className="font-medium text-blue-400 mb-2">
                                            Protection Strategy:
                                        </h4>
                                        <ul className="text-sm text-gray-300 space-y-1">
                                            <li>• Monitor health factor of selected positions</li>
                                            <li>• When threshold is reached, convert {selectedSupplyPosition.symbol} collateral to {selectedBorrowPosition.symbol}</li>
                                            <li>• Use 1inch protocol for optimal swap execution</li>
                                            <li>• Automatically repay debt to restore healthy position</li>
                                        </ul>
                                    </div>

                                    <button
                                        onClick={submitLimitOrder}
                                        disabled={!limitPrice || isSubmitting}
                                        className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-medium hover:from-purple-700 hover:to-pink-700 transition-all duration-200 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSubmitting ? (
                                            <div className="flex items-center justify-center">
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                                Setting up Protection...
                                            </div>
                                        ) : (
                                            'Set Up Liquidation Protection'
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
