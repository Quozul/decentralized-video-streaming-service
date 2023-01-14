FROM node:18-alpine

WORKDIR /app

COPY . .

RUN npm install

EXPOSE 8080
CMD ["node", "main.js"]