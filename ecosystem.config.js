module.exports = {
  apps: [
    {
      name: "driver",
      script: "/root/.bun/bin/bun",
      args: "run src/index.ts",     // or: "x ts-node src/index.ts" if you must use ts-node
      interpreter: "none",
      watch: ["src"],
      ignore_watch: ["node_modules", "logs"],
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};