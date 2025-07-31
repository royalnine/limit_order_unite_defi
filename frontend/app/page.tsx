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
    // Add these new state variables for account selection
    const [availableAccounts, setAvailableAccounts] = useState<string[]>([]);
    const [showAccountSelector, setShowAccountSelector] = useState(false);
    const [accountSummary, setAccountSummary] = useState<AaveAccountSummary | null>(null);
    const [tokenPositions, setTokenPositions] = useState<AaveTokenPosition[]>([]);
    const [supportedTokens, setSupportedTokens] = useState<AaveSupportedTokensResponse>();
    const [selectedPosition, setSelectedPosition] = useState<AaveTokenPosition | null>(null);
    const [selectedSupplyPosition, setSelectedSupplyPosition] = useState<AaveTokenPosition | null>(null);
    const [selectedBorrowPosition, setSelectedBorrowPosition] = useState<AaveTokenPosition | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [limitPrice, setLimitPrice] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);

    // Helper functions to filter positions
    const getSupplyPositions = () => {
        return tokenPositions.filter(position => parseFloat(position.tokenBalance) > 0);
    };

    const getBorrowPositions = () => {
        return tokenPositions.filter(position => 
            parseFloat(position.variableDebt) > 0 || parseFloat(position.stableDebt) > 0
        );
    };

    // Load AAVE data using Compass API
    const loadAaveData = async (userAddress: string) => {
        
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
                            token: token.symbol as AaveUserPositionPerTokenToken,
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

    // Modified connect wallet function
    const connectWallet = async () => {
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
                console.log('Available accounts:', accounts);
                setAvailableAccounts(accounts);
                
                // If only one account, connect automatically
                if (accounts.length === 1) {
                    await selectAccount(accounts[0]);
                } else {
                    // Multiple accounts - show selector
                    setShowAccountSelector(true);
                }
            }
        } catch (error: any) {
            console.error('Failed to connect wallet:', error);
            
            if (error.code === 4001) {
                alert('Please connect your wallet to continue.');
            } else if (error.message && error.message.includes('already pending')) {
                alert('A wallet connection request is already pending. Please check MetaMask and complete the request.');
            } else {
                alert('Failed to connect wallet. Please try again.');
            }
        } finally {
            setIsConnecting(false);
        }
    };

    // New function to handle account selection
    const selectAccount = async (account: string) => {
        console.log('Selecting account:', account);
        setUserAddress(account);
        setWalletConnected(true);
        setShowAccountSelector(false);
        await loadAaveData(account);
        console.log('Wallet connected:', account);
    };

    const submitLimitOrder = async () => {
        if (!selectedSupplyPosition || !selectedBorrowPosition || !limitPrice) return;

        setIsSubmitting(true);

        try {
            // TODO: Implement liquidation protection setup with 1inch protocol
            console.log('Setting up liquidation protection:', {
                supplyPosition: selectedSupplyPosition,
                borrowPosition: selectedBorrowPosition,
                limitPrice: limitPrice,
            });

            // Mock API call
            await new Promise((resolve) => setTimeout(resolve, 2000));

            alert('Liquidation protection set up successfully!');
            setLimitPrice('');
            setSelectedSupplyPosition(null);
            setSelectedBorrowPosition(null);
        } catch (error) {
            console.error('Error setting up liquidation protection:', error);
            alert('Failed to set up liquidation protection');
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
                {/* Account Selection Modal */}
                {showAccountSelector && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
                            <h3 className="text-lg font-semibold mb-4">Select Account</h3>
                            <p className="text-gray-600 mb-4">Choose which account you want to connect:</p>
                            <div className="space-y-2">
                                {availableAccounts.map((account, index) => (
                                    <button
                                        key={account}
                                        onClick={() => selectAccount(account)}
                                        className="w-full p-3 text-left border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                                    >
                                        <div className="font-medium">Account {index + 1}</div>
                                        <div className="text-sm text-gray-500 font-mono">
                                            {account.slice(0, 6)}...{account.slice(-4)}
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={() => setShowAccountSelector(false)}
                                className="mt-4 w-full p-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

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
