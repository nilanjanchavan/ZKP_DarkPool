# Off-chain matching engine for ZKDarkPool (Sepolia).
# Runtime deps only (ethers, dotenv, ts-node, typescript) are in "dependencies",
# so --omit=dev keeps the image small (hardhat/circom excluded).

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY run-matcher.ts ./

ENV NODE_ENV=production
ENV MATCH_INTERVAL_MS=60000

CMD ["npm", "start"]
