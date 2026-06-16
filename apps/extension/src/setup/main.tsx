import React from 'react'
import { createRoot } from 'react-dom/client'
import SetupAssistant from './SetupAssistant'
import '../popup/styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('No #root element found')
createRoot(container).render(<SetupAssistant />)