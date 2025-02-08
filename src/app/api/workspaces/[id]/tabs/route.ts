import { NextResponse } from "next/server"
import path from 'path'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import { ChatBubble, ChatTab, ComposerData } from "@/types/workspace"

interface RawTab {
  tabId: string;
  chatTitle: string;
  lastSendTime: number;
  bubbles: ChatBubble[];
}

const safeParseTimestamp = (timestamp: number | undefined): string => {
  try {
    if (!timestamp) {
      return new Date().toISOString();
    }
    return new Date(timestamp).toISOString();
  } catch (error) {
    console.error('Error parsing timestamp:', error, 'Raw value:', timestamp);
    return new Date().toISOString();
  }
};

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const workspacePath = process.env.WORKSPACE_PATH || ''
    const dbPath = path.join(workspacePath, params.id, 'state.vscdb')
    const globalDbPath = path.join(workspacePath, '..', 'globalStorage', 'state.vscdb')

    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    })

    // Primero intentamos con la clave del composer
    const composerResult = await db.get(`
      SELECT value FROM ItemTable
      WHERE [key] = 'composer.composerData'
    `)

    // Si no hay datos del composer, intentamos con la vista de chat
    const chatResult = await db.get(`
      SELECT value FROM ItemTable
      WHERE [key] = 'workbench.panel.composerChatViewPane'
    `)

    await db.close()

    if (!chatResult && !composerResult) {
      return NextResponse.json({ error: 'No chat data found' }, { status: 404 })
    }

    const response: { tabs: ChatTab[] } = { tabs: [] }

    if (composerResult) {
      try {
        const composerData = JSON.parse(composerResult.value)
        
        if (composerData.allComposers?.length > 0) {
          // Abrir la base de datos global para obtener los datos de conversación
          const globalDb = await open({
            filename: globalDbPath,
            driver: sqlite3.Database
          })

          const composerIds = composerData.allComposers.map((c: any) => c.composerId)
          const placeholders = composerIds.map(() => '?').join(',')
          const keys = composerIds.map((id: string) => `composerData:${id}`)

          const conversationsResult = await globalDb.all(`
            SELECT key, value FROM cursorDiskKV
            WHERE key IN (${placeholders})
          `, keys)

          await globalDb.close()

          if (conversationsResult?.length > 0) {
            const conversationsMap = new Map(
              conversationsResult.map(row => [
                row.key.replace('composerData:', ''),
                JSON.parse(row.value)
              ])
            )

            response.tabs = composerData.allComposers
              .filter((composer: any) => {
                const conversation = conversationsMap.get(composer.composerId)
                return conversation && Array.isArray(conversation.conversation)
              })
              .map((composer: any) => {
                const conversation = conversationsMap.get(composer.composerId)
                const timestamp = composer.lastUpdatedAt || composer.createdAt || Date.now()
                
                const bubbles = conversation.conversation.map((msg: any) => ({
                  type: msg.type === 1 ? 'user' : 'ai',
                  text: msg.text || msg.richText || '',
                  modelType: msg.type === 2 ? 'gpt-4' : undefined,
                  selections: msg.context?.selections || []
                }))

                return {
                  id: composer.composerId,
                  title: composer.name || `Chat ${composer.composerId.slice(0, 8)}`,
                  timestamp: new Date(timestamp).toISOString(),
                  bubbles
                }
              })
          }
        }
      } catch (error) {
        console.error('Error processing composer data:', error)
      }
    }

    if (chatResult && response.tabs.length === 0) {
      try {
        const chatData = JSON.parse(chatResult.value)
        
        if (chatData['workbench.panel.aichat.view']?.tabs) {
          response.tabs = chatData['workbench.panel.aichat.view'].tabs
            .filter((tab: any) => tab.bubbles && Array.isArray(tab.bubbles))
            .map((tab: any) => ({
              id: tab.tabId,
              title: tab.chatTitle?.split('\n')[0] || `Chat ${tab.tabId.slice(0, 8)}`,
              timestamp: safeParseTimestamp(tab.lastSendTime),
              bubbles: tab.bubbles
            }))
        }
      } catch (error) {
        console.error('Error parsing chat data:', error)
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to get workspace data:', error)
    return NextResponse.json({ error: 'Failed to get workspace data' }, { status: 500 })
  }
}
