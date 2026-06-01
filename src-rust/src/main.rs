use futures_util::{StreamExt, SinkExt};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::env;
use std::error::Error;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::Instant;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;

#[derive(Serialize, Deserialize, Debug)]
struct ExecutionSignal {
    asset: String,
    action: String,
    amount: f64,
    stop_loss: Option<f64>,
    take_profit: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct TickerMessage {
    u: u64, // order book updateId
    s: String, // symbol
    b: String, // best bid price
    B: String, // best bid qty
    a: String, // best ask price
    A: String, // best ask qty
}

#[derive(Debug, Clone)]
struct MarketState {
    best_bid: f64,
    best_ask: f64,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("🚀 Starting HFT Sniper Engine in Rust...");

    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/".to_string());
    println!("📡 Connecting to local Redis Pub/Sub for IPC: {}", redis_url);
    
    let client = redis::Client::open(redis_url)?;
    let mut con = client.get_async_connection().await?;
    let mut pubsub = con.into_pubsub();
    pubsub.subscribe("ai:execution_signals").await?;

    println!("📡 Connecting to Binance Futures Live WebSocket...");
    let binance_ws_url = Url::parse("wss://fstream.binance.com/ws/btcusdt@ticker")?;
    
    let (ws_stream, _) = connect_async(binance_ws_url).await?;
    let (mut write, mut read) = ws_stream.split();
    
    println!("✅ Sniper Ready. Listening for Execution Signals & Order Book Ticks.");

    let market_state = Arc::new(RwLock::new(MarketState { best_bid: 0.0, best_ask: 0.0 }));

    let mut message_stream = pubsub.on_message();

    loop {
        tokio::select! {
            // 1. Process Binance Ticks
            Some(msg) = read.next() => {
                if let Ok(msg) = msg {
                    if let Message::Text(text) = msg {
                        if let Ok(ticker) = serde_json::from_str::<TickerMessage>(&text) {
                            if let (Ok(bid), Ok(ask)) = (ticker.b.parse::<f64>(), ticker.a.parse::<f64>()) {
                                let mut state = market_state.write().await;
                                state.best_bid = bid;
                                state.best_ask = ask;
                            }
                        }
                    }
                }
            }
            
            // 2. Process AI Execution Signals from Redis
            Some(msg) = message_stream.next() => {
                let start_time = Instant::now();
                
                let payload: String = match msg.get_payload() {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                
                if let Ok(signal) = serde_json::from_str::<ExecutionSignal>(&payload) {
                    let state = market_state.read().await;
                    
                    let fill_price = if signal.action.contains("SELL") || signal.action.contains("SHORT") {
                        state.best_bid
                    } else {
                        state.best_ask
                    };
                    
                    let latency = start_time.elapsed();
                    
                    if fill_price > 0.0 {
                        println!("[HFT ENGINE] ⚡ FILLED {} {} @ ${:.2} (Latency: {:.2?})", 
                            signal.action, signal.asset, fill_price, latency);
                    } else {
                        println!("[HFT ENGINE] ⚠️ Received signal but market state is not initialized yet.");
                    }
                } else {
                    println!("[HFT ENGINE] Failed to parse ExecutionSignal: {}", payload);
                }
            }
        }
    }
}
