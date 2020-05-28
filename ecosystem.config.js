module.exports = {
  apps : [{
    name: 'meteo',
    script: 'ICSMeteoMonitor.js',
    // Options reference: https://pm2.keymetrics.io/docs/usage/application-declaration/
    args: 'meteo/ICSCollectConfigMeteo.json',
    error_file: 'meteo/MeteoMonitor.err',
    out_file: 'meteo/MeteoMonitor.log',
    exec_mode: 'fork',
    exp_backoff_restart_delay: 100,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '128M'
  },{
    name: 'lora',
    script: 'ICSLoraMonitor.js',
    args: 'lora/ICSCollectConfig.json',
    error_file: 'lora/LoraMonitor.err',
    out_file: 'lora/LoraMonitor.log',
    exec_mode: 'fork',
    exp_backoff_restart_delay: 100,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '128M'
  },{
    name: 'mercury',
    script: 'ICSMercuryMonitor.js',
    args: 'mercury/ICSCollectConfig.json',
    error_file: 'mercury/MercuryMonitor.err',
    out_file: 'mercury/MercuryMonitor.log',
    exec_mode: 'fork',
    exp_backoff_restart_delay: 100,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '128M'
  },{
    name: 'mercury2',
    script: 'ICSMercuryMonitor.js',
    args: 'mercury/ICSCollectConfig2.json',
    error_file: 'mercury/MercuryMonitor2.err',
    out_file: 'mercury/MercuryMonitor2.log',
    exec_mode: 'fork',
    exp_backoff_restart_delay: 100,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '128M'
  }
  ]//apps

};//exports
