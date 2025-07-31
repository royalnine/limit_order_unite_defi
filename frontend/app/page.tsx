'use client';

import { useState, useEffect } from 'react';

export default function Page() {
    const [walletConnected, setWalletConnected] = useState(false);
    const [aavePositions, setAavePositions] = useState([]);
    const [selectedPosition, setSelectedPosition] = useState(null);
    const [limitPrice, setLimitPrice] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // TODO: Implement AAVE positions loading
    const loadAavePositions = async () => {
        // Template for AAVE positions loading
        // This will be implemented by hand later
        console.log('Loading AAVE positions...');

        // Mock data for UI development
        const mockPositions = [
            {
                id: '1',
                asset: 'ETH',
                collateral: '2.5',
                borrowed: '3500',
                borrowedAsset: 'USDC',
                healthFactor: '1.45',
                liquidationPrice: '1200',
            },
            {
                id: '2',
                asset: 'WBTC',
                collateral: '0.1',
                borrowed: '2800',
                borrowedAsset: 'USDT',
                healthFactor: '1.32',
                liquidationPrice: '28000',
            },
        ];

        setAavePositions(mockPositions);
    };

    const connectWallet = async () => {
        // TODO: Implement wallet connection
        setWalletConnected(true);
        await loadAavePositions();
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
                            className="px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-medium hover:from-purple-700 hover:to-pink-700 transition-all duration-200 shadow-lg hover:shadow-purple-500/25"
                        >
                            Connect Wallet
                        </button>
                    ) : (
                        <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                            <span className="text-sm text-gray-300">Wallet Connected</span>
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
                            className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-medium hover:from-purple-700 hover:to-pink-700 transition-all duration-200 shadow-lg hover:shadow-purple-500/25"
                        >
                            Connect Wallet to Get Started
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

                            {aavePositions.length === 0 ? (
                                <div className="text-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-4"></div>
                                    <p className="text-gray-400">Loading positions...</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {aavePositions.map((position) => (
                                        <div
                                            key={position.id}
                                            className={`p-4 rounded-lg border cursor-pointer transition-all duration-200 ${
                                                selectedPosition?.id === position.id
                                                    ? 'border-purple-500 bg-purple-500/10'
                                                    : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                                            }`}
                                            onClick={() => setSelectedPosition(position)}
                                        >
                                            <div className="flex justify-between items-start mb-3">
                                                <div>
                                                    <h3 className="font-semibold text-lg">
                                                        {position.asset}
                                                    </h3>
                                                    <p className="text-sm text-gray-400">
                                                        Collateral: {position.collateral}{' '}
                                                        {position.asset}
                                                    </p>
                                                </div>
                                                <div
                                                    className={`px-2 py-1 rounded text-xs font-medium ${
                                                        parseFloat(position.healthFactor) > 1.5
                                                            ? 'bg-green-500/20 text-green-400'
                                                            : parseFloat(position.healthFactor) >
                                                                1.2
                                                              ? 'bg-yellow-500/20 text-yellow-400'
                                                              : 'bg-red-500/20 text-red-400'
                                                    }`}
                                                >
                                                    HF: {position.healthFactor}
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4 text-sm">
                                                <div>
                                                    <p className="text-gray-400">Borrowed</p>
                                                    <p className="font-medium">
                                                        {position.borrowed} {position.borrowedAsset}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-400">
                                                        Liquidation Price
                                                    </p>
                                                    <p className="font-medium">
                                                        ${position.liquidationPrice}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
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
                                                {selectedPosition.collateral}{' '}
                                                {selectedPosition.asset} →{' '}
                                                {selectedPosition.borrowed}{' '}
                                                {selectedPosition.borrowedAsset}
                                            </p>
                                            <p>
                                                Current Liquidation Price:{' '}
                                                <span className="text-red-400">
                                                    ${selectedPosition.liquidationPrice}
                                                </span>
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
                                            Order will execute when {selectedPosition.asset} price
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
