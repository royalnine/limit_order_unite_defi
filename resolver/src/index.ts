import express from 'express';
import { createHash } from 'crypto';

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
}

const orderStorage = new Map<string, StoredOrder>();

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

    const storedOrder: StoredOrder = {
      id: orderId,
      order,
      signature,
      timestamp: Date.now()
    };

    orderStorage.set(orderId, storedOrder);

    console.log(`Order stored with ID: ${orderId}`);
    console.log('Received order:', order);
    
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

app.listen(PORT, () => {
  console.log(`Order resolver server running on port ${PORT}`);
});