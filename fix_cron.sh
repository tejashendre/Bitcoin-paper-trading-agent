#!/bin/bash
(crontab -l 2>/dev/null | grep -v 'agent/cycle'; echo '0 * * * * curl -X POST "http://localhost:3000/api/agent/cycle" -H "Authorization: Bearer admin123" >> /home/ubuntu/bitcoin-quant-trader/cron.log 2>&1') | crontab -
