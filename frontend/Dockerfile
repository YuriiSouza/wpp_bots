FROM node:20

WORKDIR /app

# Dependencias
COPY package.json ./
RUN npm install

# Codigo
COPY . .

# Build de producao do Next
RUN npm run build

EXPOSE 3001

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3001"]
