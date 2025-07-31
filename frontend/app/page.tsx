'use client';

import { useState, useEffect } from 'react';
import { CompassApiSDK } from '@compass-labs/api-sdk';
import { AaveUserPositionPerTokenToken } from '@compass-labs/api-sdk/models/operations';


const sdk = new CompassApiSDK({
    apiKeyAuth: process.env.NEXT_PUBLIC_COMPASS_API_KEY,
});

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

// Extend the Window interface to include ethereum
declare global {
    interface Window {
        ethereum?: {
            request: (args: { method: string; params?: any[] }) => Promise<any>;
            on: (event: string, callback: (accounts: string[]) => void) => void;
            removeListener?: (event: string, callback: (accounts: string[]) => void) => void;
        };
    }
}

export default function Page() {
    const [walletConnected, setWalletConnected] = useState(false);
    const [userAddress, setUserAddress] = useState('');
    const [accountSummary, setAccountSummary] = useState<AaveAccountSummary | null>(null);
    const [tokenPositions, setTokenPositions] = useState<AaveTokenPosition[]>([]);
    const [supportedTokens, setSupportedTokens] = useState<AaveSupportedTokensResponse>();
    const [selectedPosition, setSelectedPosition] = useState<AaveTokenPosition | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [limitPrice, setLimitPrice] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);

    // Check for existing wallet connection on component mount
    useEffect(() => {
        const checkWalletConnection = async () => {
            if (typeof window.ethereum !== 'undefined') {
                try {
                    const accounts = await window.ethereum.request({
                        method: 'eth_accounts',
                    });
                    
                    if (accounts.length > 0) {
                        setUserAddress(accounts[0]);
                        setWalletConnected(true);
                        await loadAaveData();
                    }
                } catch (error) {
                    console.error('Error checking wallet connection:', error);
                }
            }
        };

        checkWalletConnection();

        // Listen for account changes
        if (typeof window.ethereum !== 'undefined') {
            const handleAccountsChanged = (accounts: string[]) => {
                if (accounts.length === 0) {
                    // User disconnected their wallet
                    setWalletConnected(false);
                    setUserAddress('');
                    setAccountSummary(null);
                    setTokenPositions([]);
                    setSupportedTokens(undefined);
                } else {
                    // User switched accounts
                    setUserAddress(accounts[0]);
                    loadAaveData();
                }
            };

            window.ethereum.on('accountsChanged', handleAccountsChanged);

            // Cleanup listener on component unmount
            return () => {
                if (window.ethereum?.removeListener) {
                    window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
                }
            };
        }
    }, []);

    // Load AAVE data using Compass API
    const loadAaveData = async () => {
        if (!userAddress) return;
        
        setIsLoading(true);
        
        try {
            console.log('Loading AAVE data for address:', userAddress);
            
            // Step 1: Get account summary (total health factor and other metrics)
            const summaryResponse = await sdk.aaveV3.userPositionSummary({
                chain: 'base:mainnet', // You can make this configurable
                user: userAddress,
            });
            
            if (summaryResponse) {
                setAccountSummary(summaryResponse);
                console.log('Account summary:', summaryResponse);
            }
            
            // Step 2: Get supported tokens
            const tokensResponse = await sdk.aaveV3.aaveSupportedTokens({
                chain: 'base:mainnet', // You can make this configurable
            });
            
            if (tokensResponse) {
                setSupportedTokens(tokensResponse);
                console.log('Supported tokens:', tokensResponse);
                
                // Step 3: Get position for each supported token
                const tokenPositions: AaveTokenPosition[] = [];
                
                for (const token of tokensResponse.tokens) {
                    try {
                        const positionResponse = await sdk.aaveV3.userPositionPerToken({
                            chain: 'base:mainnet',
                            user: userAddress,
                            token: token.address as AaveUserPositionPerTokenToken,
                        });
                        
                        if (positionResponse) {
                            // Only include positions where user has some balance or debt
                            const hasBalance = parseFloat(positionResponse.tokenBalance) > 0;
                            const hasDebt = parseFloat(positionResponse.stableDebt) > 0 || 
                                          parseFloat(positionResponse.variableDebt) > 0;
                            
                            if (hasBalance || hasDebt) {
                                tokenPositions.push({
                                    ...positionResponse,
                                    symbol: token.symbol,
                                    address: token.address,
                                });
                            }
                        }
                    } catch (error) {
                        console.warn(`Failed to fetch position for token ${token.symbol}:`, error);
                    }
                }
                
                setTokenPositions(tokenPositions);
                console.log('Token positions:', tokenPositions);
            }
            
        } catch (error) {
            console.error('Error loading AAVE data:', error);
            // You might want to show an error message to the user
        } finally {
            setIsLoading(false);
        }
    };

    const connectWallet = async () => {
        // Prevent multiple simultaneous connection attempts
        if (isConnecting) {
            console.log('Wallet connection already in progress...');
            return;
        }

        setIsConnecting(true);
        
        try {
            // Check if MetaMask is installed
            if (typeof window.ethereum === 'undefined') {
                alert('MetaMask is not installed. Please install MetaMask to continue.');
                return;
            }

            // First try to get existing accounts without requesting
            let accounts = await window.ethereum.request({
                method: 'eth_accounts',
            });

            // If no accounts, request access
            if (accounts.length === 0) {
                accounts = await window.ethereum.request({
                    method: 'eth_requestAccounts',
                });
            }

            if (accounts.length > 0) {
                setUserAddress(accounts[0]);
                setWalletConnected(true);
                await loadAaveData();
                console.log('Wallet connected:', accounts[0]);
            }
        } catch (error: any) {
            console.error('Failed to connect wallet:', error);
            
            if (error.code === 4001) {
                // User rejected the connection request
                alert('Please connect your wallet to continue.');
            } else if (error.message && error.message.includes('already pending')) {
                // Handle the specific case of pending requests
                alert('A wallet connection request is already pending. Please check MetaMask and complete the request.');
            } else {
                alert('Failed to connect wallet. Please try again.');
            }
        } finally {
            setIsConnecting(false);
        }
    };

    const submitLimitOrder = async () => {
        if (!selectedPosition || !limitPrice) return;

        setIsSubmitting(true);

        try {
            // TODO: Implement limit order submission with 1inch protocol
            console.log('Submitting limit order:', {
                position: selectedPosition,
                limitPrice: limitPrice,
            });

            // Mock API call
            await new Promise((resolve) => setTimeout(resolve, 2000));

            alert('Limit order submitted successfully!');
            setLimitPrice('');
            setSelectedPosition(null);
        } catch (error) {
            console.error('Error submitting limit order:', error);
            alert('Failed to submit limit order');
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
                    <div className="grid lg:grid-cols-2 gap-8">
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

                                    {/* Individual Token Positions */}
                                    {tokenPositions.length === 0 ? (
                                        <div className="text-center py-8">
                                            <p className="text-gray-400">No active positions found</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <h3 className="font-semibold text-lg">Individual Token Positions</h3>
                                            {tokenPositions.map((position) => (
                                                <div
                                                    key={position.address}
                                                    className={`p-4 rounded-lg border cursor-pointer transition-all duration-200 ${
                                                        selectedPosition?.address === position.address
                                                            ? 'border-purple-500 bg-purple-500/10'
                                                            : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                                                    }`}
                                                    onClick={() => setSelectedPosition(position)}
                                                >
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div>
                                                            <h4 className="font-semibold text-lg">
                                                                {position.symbol}
                                                            </h4>
                                                            <p className="text-sm text-gray-400">
                                                                aToken Balance: {(parseFloat(position.tokenBalance) / Math.pow(10, 18)).toFixed(6)}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                                        <div>
                                                            <p className="text-gray-400">Variable Debt</p>
                                                            <p className="font-medium">
                                                                {(parseFloat(position.variableDebt) / Math.pow(10, 18)).toFixed(6)} {position.symbol}
                                                            </p>
                                                        </div>
                                                        <div>
                                                            <p className="text-gray-400">Stable Debt</p>
                                                            <p className="font-medium">
                                                                {(parseFloat(position.stableDebt) / Math.pow(10, 18)).toFixed(6)} {position.symbol}
                                                            </p>
                                                        </div>
                                                        <div>
                                                            <p className="text-gray-400">Variable Rate</p>
                                                            <p className="font-medium">
                                                                {(parseFloat(position.variableBorrowRate) / 1e25 * 100).toFixed(2)}%
                                                            </p>
                                                        </div>
                                                        <div>
                                                            <p className="text-gray-400">Liquidity Rate</p>
                                                            <p className="font-medium">
                                                                {(parseFloat(position.liquidityRate) / 1e25 * 100).toFixed(2)}%
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
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

                            {!selectedPosition ? (
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
                                                d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m-9 0h10m-10 0a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V6a2 2 0 00-2-2"
                                            />
                                        </svg>
                                    </div>
                                    <p className="text-gray-400">
                                        Select a position to set up protection
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    <div className="p-4 bg-gray-800/50 rounded-lg">
                                        <h3 className="font-semibold mb-2">Selected Position</h3>
                                        <div className="text-sm text-gray-300">
                                            <p>
                                                aToken Balance: {(parseFloat(selectedPosition.tokenBalance) / Math.pow(10, 18)).toFixed(6)} {selectedPosition.symbol}
                                            </p>
                                            <p>
                                                Variable Debt: {(parseFloat(selectedPosition.variableDebt) / Math.pow(10, 18)).toFixed(6)} {selectedPosition.symbol}
                                            </p>
                                            <p>
                                                Stable Debt: {(parseFloat(selectedPosition.stableDebt) / Math.pow(10, 18)).toFixed(6)} {selectedPosition.symbol}
                                            </p>
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
                                            Order will execute when {selectedPosition.symbol} price
                                            reaches this level
                                        </p>
                                    </div>

                                    <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                                        <h4 className="font-medium text-blue-400 mb-2">
                                            How it works:
                                        </h4>
                                        <ul className="text-sm text-gray-300 space-y-1">
                                            <li>• Limit order triggers at your specified price</li>
                                            <li>• 1inch protocol executes the swap</li>
                                            <li>• Proceeds automatically supply to AAVE</li>
                                            <li>• Your position gets protected from liquidation</li>
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
                                                Submitting Order...
                                            </div>
                                        ) : (
                                            'Submit Limit Order'
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
