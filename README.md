# rd-replay-data

Hourly 1-minute market candles for **RD Replay** (RD Project's chart replay / backtesting tool).

- `data/<MARKET>/<YEAR>/<YYYY-MM-DD>.csv`: one file per market per UTC day, columns `t,o,h,l,c,v` (`t` = candle open time, Unix seconds, UTC).
- `data/index.json`: first and last day per market and the time of the last update.
- Markets: EURUSD, GBPUSD, USDJPY, XAUUSD (Massive free plan, needs the `MASSIVE_API_KEY` repository secret) and BTCUSD (Binance public market data, as BTC/USDT).
- Updated every hour by `.github/workflows/update.yml`. Run it by hand from the Actions tab with `days = 730` to load 2 years of history.

Data comes from third-party providers and is for testing RD Replay. Check each provider's terms before any commercial use.
