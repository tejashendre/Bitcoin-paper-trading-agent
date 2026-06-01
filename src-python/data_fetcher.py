import ccxt
import pandas as pd
import time
from datetime import datetime, timedelta
import os

def fetch_binance_data(symbol="BTC/USDT", timeframe="15m", years=3, output_dir="data"):
    print(f"Initializing data fetch for {symbol} ({timeframe}) over the last {years} years...")
    
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    exchange = ccxt.binance({
        'enableRateLimit': True,
    })
    
    end_time = datetime.now()
    start_time = end_time - timedelta(days=365 * years)
    
    since = int(start_time.timestamp() * 1000)
    all_ohlcv = []
    
    print(f"Fetching from {start_time.strftime('%Y-%m-%d')} to {end_time.strftime('%Y-%m-%d')}...")
    
    while since < int(end_time.timestamp() * 1000):
        try:
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe, since=since, limit=1000)
            if not ohlcv:
                break
                
            all_ohlcv.extend(ohlcv)
            # Update 'since' to the last timestamp + 1 millisecond
            since = ohlcv[-1][0] + 1
            
            # Print progress
            current_date = datetime.fromtimestamp(since / 1000).strftime('%Y-%m-%d')
            print(f"Fetched up to {current_date}...")
            
            # Be nice to the API
            time.sleep(0.5)
            
        except Exception as e:
            print(f"Error fetching data: {e}")
            time.sleep(5) # Backoff
            
    if not all_ohlcv:
        print("No data fetched.")
        return
        
    df = pd.DataFrame(all_ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
    
    # Save to CSV
    filename = f"{symbol.replace('/', '')}_{timeframe}_{years}y.csv"
    filepath = os.path.join(output_dir, filename)
    df.to_csv(filepath, index=False)
    print(f"Successfully saved {len(df)} candles to {filepath}")

if __name__ == "__main__":
    fetch_binance_data("BTC/USDT", "15m", 3)
