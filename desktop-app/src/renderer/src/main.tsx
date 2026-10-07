import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { leaveDemo } from './lib/demoData'

// O modo demonstração não tem mais botão na tela: se ficou ativo, volta para os dados reais ao abrir.
leaveDemo()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
