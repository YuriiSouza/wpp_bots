FROM node:20-alpine

WORKDIR /app

# Dependências
COPY package*.json ./
RUN npm install

# Código
COPY . .

# Porta do Nest
EXPOSE 3000

# Prisma precisa gerar client
RUN npx prisma generate

CMD ["npm", "run", "start:dev"]