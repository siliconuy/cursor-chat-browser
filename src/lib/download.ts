import { ChatTab } from "@/types/workspace"
import { marked } from 'marked'
import JSZip from 'jszip'

export function convertChatToMarkdown(tab: ChatTab): string {
  let markdown = `# ${tab.title || `Chat ${tab.id}`}\n\n`
  markdown += `_Created: ${new Date(tab.timestamp).toLocaleString()}_\n\n---\n\n`
  
  tab.bubbles.forEach((bubble) => {
    // Add speaker
    markdown += `### ${bubble.type === 'ai' ? `AI (${bubble.modelType})` : 'User'}\n\n`
    
    // Add selections if any
    if (bubble.selections?.length) {
      markdown += '**Selected Code:**\n\n'
      bubble.selections.forEach((selection) => {
        markdown += '```\n' + selection.text + '\n```\n\n'
      })
    }
    
    // Add message text
    if (bubble.text) {
      markdown += bubble.text + '\n\n'
    }
    
    markdown += '---\n\n'
  })
  
  return markdown
}

export function downloadMarkdown(tab: ChatTab) {
  const markdown = convertChatToMarkdown(tab)
  const blob = new Blob([markdown], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${tab.title || `chat-${tab.id}`}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadHTML(tab: ChatTab) {
  const markdown = convertChatToMarkdown(tab)
  const html = marked(markdown)
  const fullHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${tab.title || `Chat ${tab.id}`}</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
          pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow-x: auto; }
          hr { border: 0; border-top: 1px solid #eaecef; margin: 2rem 0; }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `
  const blob = new Blob([fullHtml], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${tab.title || `chat-${tab.id}`}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadPDF(tab: ChatTab) {
  const markdown = convertChatToMarkdown(tab)
  const html = marked(markdown)
  const style = `
    <style>
      body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
      pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow-x: auto; }
      hr { border: 0; border-top: 1px solid #eaecef; margin: 2rem 0; }
    </style>
  `
  const printWindow = window.open('', '', 'width=800,height=600')
  if (printWindow) {
    printWindow.document.write(style + html)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
    }, 250)
  }
}

export async function downloadAllAsZip(format: 'markdown' | 'html' | 'pdf') {
  try {
    console.log('Fetching all workspaces...')
    const response = await fetch('/api/workspaces')
    const workspaces = await response.json()
    console.log(`Found ${workspaces.length} workspaces to process:`, workspaces)
    
    if (!Array.isArray(workspaces) || workspaces.length === 0) {
      console.error('No workspaces found or invalid response:', workspaces)
      return
    }
    
    const zip = new JSZip()
    const processedFiles: { workspace: string, fileName: string }[] = []
    
    // Procesar los workspaces secuencialmente para evitar condiciones de carrera
    for (let i = 0; i < workspaces.length; i++) {
      const workspace = workspaces[i]
      console.log(`Processing workspace ${i + 1}/${workspaces.length}:`, workspace)
      const tabsResponse = await fetch(`/api/workspaces/${workspace.id}/tabs`)
      const data = await tabsResponse.json()
      console.log(`Response for workspace ${workspace.id}:`, data)
      
      if (!data || typeof data !== 'object') {
        console.error(`Invalid response for workspace ${workspace.id}:`, data)
        continue
      }
      
      const { tabs, composers } = data
      
      if (!Array.isArray(tabs)) {
        console.error(`Invalid tabs data for workspace ${workspace.id}:`, tabs)
        continue
      }
      
      if (tabs?.length > 0) {
        console.log(`Found ${tabs.length} chat logs in workspace ${workspace.id}:`, tabs)
        const wsFolder = zip.folder(workspace.id)
        if (!wsFolder) {
          console.error(`Failed to create folder for workspace ${workspace.id}`)
          continue
        }
        
        // Procesar los tabs secuencialmente para evitar condiciones de carrera
        for (let j = 0; j < tabs.length; j++) {
          const tab = tabs[j]
          try {
            console.log(`Processing tab ${j + 1}/${tabs.length}:`, tab)
            
            if (!tab || !tab.bubbles || !Array.isArray(tab.bubbles)) {
              console.error(`Invalid tab data:`, tab)
              continue
            }
            
            const markdown = convertChatToMarkdown(tab)
            console.log(`Generated markdown for tab ${tab.id}:`, markdown.substring(0, 100) + '...')
            
            const content = format === 'markdown' 
              ? markdown
              : format === 'html' 
                ? await marked(markdown)
                : markdown // PDF not supported in zip, fallback to markdown
            
            console.log(`Generated content for tab ${tab.id}:`, content.substring(0, 100) + '...')
                
            const extension = format === 'html' ? 'html' : 'md'
            const fileName = `${tab.title || `chat-${tab.id}`}.${extension}`
            
            if (format === 'html') {
              const fullHtml = `
                <!DOCTYPE html>
                <html>
                  <head>
                    <meta charset="utf-8">
                    <title>${tab.title || `Chat ${tab.id}`}</title>
                    <style>
                      body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
                      pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow-x: auto; }
                      hr { border: 0; border-top: 1px solid #eaecef; margin: 2rem 0; }
                    </style>
                  </head>
                  <body>${content}</body>
                </html>
              `
              wsFolder.file(fileName, fullHtml)
            } else {
              wsFolder.file(fileName, content)
            }
            
            processedFiles.push({ workspace: workspace.id, fileName })
            console.log(`Added file ${j + 1}/${tabs.length}: ${fileName} in workspace ${workspace.id}`)
          } catch (error) {
            console.error(`Error processing tab ${j}:`, error)
          }
        }
      } else {
        console.log(`No chat logs found in workspace ${workspace.id}`)
      }
    }
    
    if (processedFiles.length === 0) {
      console.error('No files were added to the zip')
      return
    }
    
    console.log(`Generating zip file with ${processedFiles.length} files:`, processedFiles)
    const blob = await zip.generateAsync({ type: 'blob' })
    console.log('Zip file generated, size:', blob.size)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cursor-logs.${format === 'html' ? 'html' : 'md'}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    console.log('Download complete!')
  } catch (error) {
    console.error('Failed to download all logs:', error)
  }
}

export function copyMarkdown(tab: ChatTab) {
  const markdown = convertChatToMarkdown(tab)
  navigator.clipboard.writeText(markdown)
}