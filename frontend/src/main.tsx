import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Remove static SEO content once React hydrates (crawlers already parsed it)
const seoContent = document.getElementById('seo-content')
if (seoContent) seoContent.remove()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
