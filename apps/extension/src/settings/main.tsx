import React from 'react'
import { createRoot } from 'react-dom/client'
import SettingsApp from './SettingsApp'
import '../popup/styles.css'
import './settings.css'

const root = document.getElementById('root')
if (!root) throw new Error('No #root element found')
createRoot(root).render(<SettingsApp />)
