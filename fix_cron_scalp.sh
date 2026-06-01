#!/bin/bash
source /home/ubuntu/bitcoin-quant-trader/.env.local
(
  crontab -l 2>/dev/null | grep -v 'agent/cycle' | grep -v 'trade/scalp'
  echo "0 * * * * curl -X POST \"http://localhost:3000/api/agent/cycle\" -H \"Authorization: Bearer $CRON_SECRET\" >> /home/ubuntu/bitcoin-quant-trader/cron_cycle.log 2>&1"
  echo "* * * * * curl -X POST \"http://localhost:3000/api/trade/scalp?asset=all\" -H \"Authorization: Bearer $CRON_SECRET\" >> /home/ubuntu/bitcoin-quant-trader/cron_scalp.log 2>&1"
) | crontab -
