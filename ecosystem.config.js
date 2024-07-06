module.exports = {
    apps: [
      {
        name: "driver",
        script: "node_modules/.bin/ts-node",
        args: "src/index.ts", // path to your entry TypeScript file
        watch: ["src"],
        ignore_watch: ["node_modules", "logs"],
        interpreter: "none",
        env: {
          NODE_ENV: "development",
        },
        env_production: {
          NODE_ENV: "production",
        },
      },
    ],
  };