# Unite DeFi - Anti-Liquidation Platform

This repository contains a comprehensive DeFi protection platform that helps users avoid liquidation on AAVE V3 by creating and managing limit orders. The platform integrates with AAVE V3 on Base mainnet to monitor user positions and execute protective actions when live price passes through the threshold set for the limit order. 

For example a user has supplied `ETH` and borrowed `USDC` on `AAVE` , in this case they are exposed to liquidation risk should the price of ETH drop to bring the total health factor of the account to be below 1. What this solution will help users achieve is being able to set limit orders to exchange the borrowed assets into collateral when a limit price is achieved, then use these funds to resupply into the account increasing the health of the account to protect against liquidations.

## Actors

In the context of the limit order protocol, a user on this platform is a `maker`. A counter-party that performs market making, ie filling orders is a `taker`. For the purposes of the demo, the `taker` account is hardcoded here and in order to fill the orders, this account needs to be in possession of enough taking assets.

## 🚀 Features

- **Real-time Position Monitoring**: Track your AAVE V3 supply and borrow positions
- **Anti-Liquidation Protection**: Create limit orders to prevent liquidations
- **Health Factor Monitoring**: Keep track of your position health in real-time
- **Smart Contract Integration**: Post-interaction logic via a deployed contract

## 🏗️ Architecture

The platform consists of four main components:

1. **Frontend**: 

This is a next js application that queries Compass API for the AAVE V3 positions allowing users to select a pair of collateral and borrow position to set limit orders for the tokens used in these positions. Encodes all function calls required to perform the anti-liquidation action.

2. **Backend**:

Script used during development to test `Resolver API` running against locally spun up fork of a chain using `anvil`. **NOTE** this is not used in the final product, just left for whoever is curious.

3. **Smart Contracts**:

`AntiLiquidationPostInteraction` contract implementing `IPostInteraction` interface to delegate call into the `MulticallV3` in order to perform 3 things (encoded in the frontend):
- Allowing AAVE Pool to move funds on behalf of the maker.
- Sending exchanged already exchanged assets to the `AntiLiquidationPostInteraction`.
- Performing a supply on AAVE.

4. **Resolver**: 

Express js service that performs 3 main functionalities:
- Stores submitted orders in memory.
- Exposes an endpoint to poll fillable orders to the FE. The current price of the assets is fetched using `https://api.1inch.dev/price/v1.1` endpoint.
- Fills suitable limit orders.

## 📱 User Interface Walkthrough

### 1. Initial Dashboard
![Initial Screen](docs/Initial%20screen.png)

The main dashboard provides an overview of your AAVE positions and allows you to:
- Connect your wallet (MetaMask or compatible).
- View account summary with health factor.
- Monitor total collateral and debt.
- Access position management tools.

### 2. Position Selection
![Positions Selected](docs/positions%20selected.png)

Once connected, you can:
- View your supply positions (assets you've deposited).
- See your borrow positions (assets you've borrowed).
- Select positions you want to use in order to protect from liquidation.
- Set limit price.

### 3. Order Management
![Order for Filling](docs/order%20for%20filling.png)

The platform provides comprehensive order management:
- View fillable orders in real-time.
- Monitor order status and parameters.
- Fill available orders manually or automatically.
- Track order execution and results.

The `Fillable orders` part of the UI is meant to be used by the counter party (takers) to fill the limit orders.

### Environment Variables

**Frontend**
```
NEXT_PUBLIC_COMPASS_API_KEY=<your_compass_api_key>
NEXT_PUBLIC_RESOLVER_URL=http://localhost:3001
```

**Resolver**
```
TAKER_PRIVATE_KEY=<counter_party_private_key>
BASE_RPC_URL=<base_rpc_url>
ONEINCH_API_KEY=<one_inch_api_key>
```

## 🔧 Configuration

### Supported Networks
- **Base Mainnet** (Chain ID: 8453)

### Contract Addresses
- **AAVE Pool**: `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- **Multicall3**: `0xca11bde05977b3631167028862be2a173976ca11`
- **Post Interaction**: `0x8815Ab44465734eF2C41de36cff0ab130e1ab32B`

## Future work

This can go beyond just AAVE, this can be expanded to support any kind of lending protocol out there.
