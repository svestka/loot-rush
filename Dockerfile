FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
ENV BUG_RACE_CONDITION=true
ENV BUG_DEADLOCK=false

EXPOSE 3000

CMD ["node", "server.js"]
