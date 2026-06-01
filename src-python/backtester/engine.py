import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import os

def compute_rsi(data, period=14):
    delta = data.diff()
    up, down = delta.copy(), delta.copy()
    up[up < 0] = 0
    down[down > 0] = 0
    
    # Calculate the EWMA
    roll_up = up.ewm(span=period).mean()
    roll_down = down.abs().ewm(span=period).mean()
    
    RS = roll_up / roll_down
    RSI = 100.0 - (100.0 / (1.0 + RS))
    return RSI

def compute_macd(data, fast=12, slow=26, signal=9):
    exp1 = data.ewm(span=fast, adjust=False).mean()
    exp2 = data.ewm(span=slow, adjust=False).mean()
    macd = exp1 - exp2
    exp3 = macd.ewm(span=signal, adjust=False).mean()
    histogram = macd - exp3
    return macd, exp3, histogram

def run_backtest(csv_file, initial_capital=10000.0, fee_pct=0.0005, slippage_pct=0.0005):
    print(f"Loading data from {csv_file}...")
    df = pd.read_csv(csv_file)
    df['datetime'] = pd.to_datetime(df['datetime'])
    
    print("Computing indicators...")
    df['rsi'] = compute_rsi(df['close'], 14)
    df['macd_line'], df['macd_signal'], df['macd_hist'] = compute_macd(df['close'])
    df['ema_21'] = df['close'].ewm(span=21, adjust=False).mean()
    df['ema_50'] = df['close'].ewm(span=50, adjust=False).mean()
    df['ema_200'] = df['close'].ewm(span=200, adjust=False).mean()
    
    # Drop NaNs
    df.dropna(inplace=True)
    df.reset_index(drop=True, inplace=True)
    
    # Simulate Brain Logic
    # Simple logic mimicking our AutonomousBrain setup:
    # BUY if RSI < 40 and MACD crosses up and Close > EMA200
    # SHORT if RSI > 60 and MACD crosses down and Close < EMA200
    
    capital = initial_capital
    position = None # 'LONG' or 'SHORT'
    entry_price = 0.0
    amount = 0.0
    
    equity_curve = []
    dates = []
    trades = []
    
    print(f"Starting backtest simulation with ${initial_capital}...")
    
    for i in range(1, len(df)):
        current_price = df['close'].iloc[i]
        prev_macd = df['macd_hist'].iloc[i-1]
        curr_macd = df['macd_hist'].iloc[i]
        rsi = df['rsi'].iloc[i]
        ema200 = df['ema_200'].iloc[i]
        date = df['datetime'].iloc[i]
        
        # Check Exits
        if position == 'LONG':
            if curr_macd < 0 or rsi > 70: # Exit condition
                exit_price = current_price * (1 - slippage_pct)
                pnl = (exit_price - entry_price) * amount
                capital += pnl
                capital -= (amount * exit_price * fee_pct) # Exit fee
                trades.append({'date': date, 'type': 'SELL', 'pnl': pnl, 'capital': capital})
                position = None
        elif position == 'SHORT':
            if curr_macd > 0 or rsi < 30: # Exit condition
                exit_price = current_price * (1 + slippage_pct)
                pnl = (entry_price - exit_price) * amount
                capital += pnl
                capital -= (amount * exit_price * fee_pct) # Exit fee
                trades.append({'date': date, 'type': 'COVER', 'pnl': pnl, 'capital': capital})
                position = None
                
        # Check Entries
        if position is None:
            if curr_macd > 0 and prev_macd <= 0 and 40 < rsi < 60 and current_price > ema200 and df['ema_50'].iloc[i] > ema200:
                # Enter LONG
                position = 'LONG'
                entry_price = current_price * (1 + slippage_pct)
                risk_amount = capital * 0.02 # Risk 2% per trade
                amount = risk_amount / entry_price
                capital -= (risk_amount * fee_pct) # Entry fee
                trades.append({'date': date, 'type': 'BUY', 'pnl': 0, 'capital': capital})
            elif curr_macd < 0 and prev_macd >= 0 and 40 < rsi < 60 and current_price < ema200 and df['ema_50'].iloc[i] < ema200:
                # Enter SHORT
                position = 'SHORT'
                entry_price = current_price * (1 - slippage_pct)
                risk_amount = capital * 0.02 # Risk 2% per trade
                amount = risk_amount / entry_price
                capital -= (risk_amount * fee_pct) # Entry fee
                trades.append({'date': date, 'type': 'SHORT', 'pnl': 0, 'capital': capital})
                
        # Track daily equity
        if i % 96 == 0: # Approx 1 day for 15m candles
            unrealized_pnl = 0
            if position == 'LONG':
                unrealized_pnl = (current_price - entry_price) * amount
            elif position == 'SHORT':
                unrealized_pnl = (entry_price - current_price) * amount
            
            equity_curve.append(capital + unrealized_pnl)
            dates.append(date)

    print(f"Backtest completed. Final Capital: ${capital:.2f}")
    print(f"Total Trades: {len([t for t in trades if t['type'] in ['SELL', 'COVER']])}")
    
    if len(equity_curve) > 0:
        plt.figure(figsize=(12, 6))
        plt.plot(dates, equity_curve, label='Equity Curve', color='blue')
        plt.title('Autonomous Agent Strategy Backtest (3 Years)')
        plt.xlabel('Date')
        plt.ylabel('Portfolio Value (USD)')
        plt.legend()
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        plt.savefig(os.path.join(os.path.dirname(csv_file), 'backtest_results.png'))
        print("Chart saved as backtest_results.png")

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        run_backtest(sys.argv[1])
    else:
        print("Usage: python engine.py path/to/data.csv")
