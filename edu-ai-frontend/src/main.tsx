import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ThemeProvider } from './components/theme-provider'
import { AuthProvider } from './lib/auth.tsx'
import './index.css'
import { TooltipProvider } from './components/ui/tooltip.tsx'

createRoot(document.getElementById('root')!).render(
  <ThemeProvider defaultTheme="system" storageKey="edu-ui-theme">
    <TooltipProvider>
      <AuthProvider>
        <StrictMode>
          <App />
        </StrictMode>
      </AuthProvider>
    </TooltipProvider>
  </ThemeProvider>,
)
