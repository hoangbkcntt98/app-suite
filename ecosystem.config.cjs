
module.exports = {
  apps: [{
    name: "app-suite",
    cwd: "/var/www/app-suite",
    script: "node_modules/next/dist/bin/next",
    args: "start -H 127.0.0.1 -p 3003",
    instances: 1,
    exec_mode: "fork",
    env: {
      NODE_ENV: "production"
    },
    max_memory_restart: "2G",
    autorestart: true,
    time: true
  }]
};
