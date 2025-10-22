FROM node:24-alpine

RUN mkdir -p /home/node/bot && chown -R node:node /home/node/bot
WORKDIR /home/node/bot

COPY package*.json ./
COPY release-deposits.js ./
COPY account.json ./
COPY bot-loop.sh ./

RUN chown -R node: /home/node/bot && chmod +x bot-loop.sh
USER node
RUN npm ci --ignore-scripts

CMD ["./bot-loop.sh"]
