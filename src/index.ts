import dotenv from 'dotenv'
import TelegramBot from 'node-telegram-bot-api'
import { Agent } from '@openserv-labs/sdk'
import { z } from 'zod'

// Load environment variables
dotenv.config()

class SimpleTelegramBot extends Agent {
  private bot: TelegramBot
  private workspaceId: number
  private agentId: number

  constructor() {
    // Validate required environment variables
    const requiredVars = ['TELEGRAM_BOT_TOKEN', 'OPENSERV_API_KEY', 'WORKSPACE_ID', 'AGENT_ID']
    const missingVars = requiredVars.filter(varName => !process.env[varName])
    
    if (missingVars.length > 0) {
      console.error('❌ Missing required environment variables:', missingVars)
      process.exit(1)
    }

    // Initialize Agent (parent class)
    super({
      systemPrompt: 'You are a helpful assistant.',
      apiKey: process.env.OPENSERV_API_KEY!
    })

    // Initialize bot
    this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, { polling: true })
    this.workspaceId = parseInt(process.env.WORKSPACE_ID!)
    this.agentId = parseInt(process.env.AGENT_ID!)


    this.setupHandlers()
  }


  private setupHandlers() {
    // Handle /start command
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id
      await this.bot.sendMessage(chatId, 
        '🤖 Simple OpenServ Bot!\
\
Usage: /ask [your question]\
Example: /ask What is OpenServ?'
      )
    })

    // Handle /ask command
    this.bot.onText(/\/ask (.+)/, async (msg, match) => {
      const chatId = msg.chat.id
      const question = match?.[1]

      if (!question) {
        await this.bot.sendMessage(chatId, '❌ Please write a question: /ask [your question]')
        return
      }

      // Send typing indicator
      this.bot.sendChatAction(chatId, 'typing')

      try {
        console.log(`📝 Question received: \"${question}\"`)
        console.log(`💬 Using marketplace agent ${this.agentId} via chat message...`)
        
        // Use sendChatMessage for marketplace agents
        const chatResponse = await this.sendChatMessage({
          workspaceId: this.workspaceId,
          agentId: this.agentId, 
          message: question
        })

        console.log(`✅ Chat response received:`, chatResponse)
        
        // Handle the response from marketplace agent
        if (chatResponse && (chatResponse.message || chatResponse.content)) {
          // Extract message from response (format may vary)
          const responseText = chatResponse.message || chatResponse.content
          await this.bot.sendMessage(chatId, `🤖 Agent Response:\n\n${responseText}`)
        } else {
          // Chat message sent but no immediate response - this is normal for marketplace agents
          console.log('📨 Chat message sent successfully, but no immediate response')
          console.log('🔍 Full response object:', JSON.stringify(chatResponse, null, 2))
          
          // Wait for agent to respond and get the latest message
          await this.bot.sendMessage(chatId, `✅ Question sent to agent. Getting response...`)
          
          // Simple delay and get response
          await new Promise(resolve => setTimeout(resolve, 3000)) // Wait 3 seconds
          
          try {
            const chatMessages = await this.getChatMessages({
              workspaceId: this.workspaceId,
              agentId: this.agentId
            })
            
            if (chatMessages && chatMessages.messages && chatMessages.messages.length > 0) {
              // Get the last agent message
              const agentMessages = chatMessages.messages.filter(msg => msg.author === 'agent')
              if (agentMessages.length > 0) {
                const latestResponse = agentMessages[agentMessages.length - 1]
                await this.bot.sendMessage(chatId, `🤖 Agent Response:\n\n${latestResponse.message}`)
              } else {
                await this.bot.sendMessage(chatId, `⏰ No response yet. Please try again.`)
              }
            }
          } catch (chatError) {
            console.error('❌ Error getting chat messages:', chatError)
            await this.bot.sendMessage(chatId, `❌ Error getting response. Please try again.`)
          }
        }

      } catch (error) {
        console.error('Error processing question:', error)
        await this.bot.sendMessage(chatId, `❌ Error communicating with agent: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    })

    // Handle /help command
    this.bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id
      const helpText = `
📖 Help:

Commands:
• /start - Start the bot
• /ask [question] - Ask a question
• /help - Show this help message

Example:
/ask Give information about OpenServ platform
      `
      await this.bot.sendMessage(chatId, helpText)
    })

    // Error handling
    this.bot.on('polling_error', (error) => {
      console.error('Telegram polling error:', error)
    })

    console.log('✅ Telegram bot handlers set up successfully!')
  }


  public async start(): Promise<void> {
    try {
      console.log('🚀 Starting Simple OpenServ Telegram Bot...')
      
      // Start the OpenServ agent server
      await super.start()
      
      console.log('✅ Bot is running! Send /start to begin.')

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\
⏹️ Shutting down bot...')
        this.bot.stopPolling()
        process.exit(0)
      })

    } catch (error) {
      console.error('❌ Error starting bot:', error)
      process.exit(1)
    }
  }
}

// Start the bot
if (require.main === module) {
  const bot = new SimpleTelegramBot()
  bot.start()
}

export default SimpleTelegramBot
