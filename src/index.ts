import dotenv from 'dotenv'
import TelegramBot from 'node-telegram-bot-api'
import { Agent } from '@openserv-labs/sdk'
import { z } from 'zod'

// Load environment variables
dotenv.config()

class SimpleTelegramBot extends Agent {
  private bot: TelegramBot
  private workspaceId: number
  private currentAgentId: number
  private availableAgents: Record<string, { id: number, name: string, description: string }>

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
    this.currentAgentId = parseInt(process.env.AGENT_ID!)
    
    // Initialize available agents (marketplace agents)
    this.availableAgents = {
      'project-manager': { id: 1, name: 'Project Manager', description: 'Manages projects and coordinates tasks' },
      'research-assistant': { id: 2, name: 'Research Assistant', description: 'Conducts research and provides detailed information' },
      'general-assistant': { id: 3, name: 'General Assistant', description: 'Provides general help and support' }
    }

    this.setupHandlers()
  }


  private setupHandlers() {
    // Handle /start command
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id
      const currentAgent = this.getAgentName(this.currentAgentId)
      await this.bot.sendMessage(chatId, 
        `🤖 Multi-Agent OpenServ Bot!\
\
Current Agent: ${currentAgent}\
\
Commands:\
• /ask [question] - Ask current agent\
• /agent - Switch agents\
• /agents - List all agents\
• /help - Show help\
\
Example: /ask What is OpenServ?`
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
        console.log(`💬 Using marketplace agent ${this.currentAgentId} via chat message...`)
        
        // Use sendChatMessage for marketplace agents
        const chatResponse = await this.sendChatMessage({
          workspaceId: this.workspaceId,
          agentId: this.currentAgentId, 
          message: question
        })

        console.log(`✅ Chat response received:`, chatResponse)
        
        // Handle the response from marketplace agent
        if (chatResponse && (chatResponse.message || chatResponse.content)) {
          // Extract message from response (format may vary)
          const responseText = chatResponse.message || chatResponse.content
          const agentName = this.getAgentName(this.currentAgentId)
          await this.bot.sendMessage(chatId, `🤖 ${agentName} Response:\n\n${responseText}`)
        } else {
          // Chat message sent but no immediate response - this is normal for marketplace agents
          console.log('📨 Chat message sent successfully, but no immediate response')
          console.log('🔍 Full response object:', JSON.stringify(chatResponse, null, 2))
          
          // Wait for agent to respond and get the latest message
          await this.bot.sendMessage(chatId, `✅ Question sent to agent. Getting response...`)
          
          // Enhanced polling with retry logic
          const response = await this.getAgentResponse(this.workspaceId, this.currentAgentId, question)
          
          if (response) {
            const agentName = this.getAgentName(this.currentAgentId)
            await this.bot.sendMessage(chatId, `🤖 ${agentName} Response:\n\n${response}`)
          } else {
            await this.bot.sendMessage(chatId, `⏰ No response received within timeout. Please try again.`)
          }
        }

      } catch (error) {
        console.error('Error processing question:', error)
        await this.bot.sendMessage(chatId, `❌ Error communicating with agent: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    })

    // Handle /agents command - List all available agents
    this.bot.onText(/\/agents/, async (msg) => {
      const chatId = msg.chat.id
      const agentsList = Object.values(this.availableAgents)
        .map(agent => `• ${agent.name} (ID: ${agent.id})\n  ${agent.description}`)
        .join('\n\n')
      
      const currentAgent = this.getAgentName(this.currentAgentId)
      await this.bot.sendMessage(chatId, 
        `🤖 Available Agents:\n\n${agentsList}\n\n✅ Current: ${currentAgent}\n\nUse /agent to switch agents`
      )
    })

    // Handle /agent command - Switch between agents
    this.bot.onText(/\/agent/, async (msg) => {
      const chatId = msg.chat.id
      const keyboard = Object.values(this.availableAgents).map(agent => [{
        text: `${agent.name} (ID: ${agent.id})`,
        callback_data: `agent_${agent.id}`
      }])
      
      await this.bot.sendMessage(chatId, 
        '🔄 Select an agent:', 
        { 
          reply_markup: { 
            inline_keyboard: keyboard 
          } 
        }
      )
    })

    // Handle agent selection callbacks
    this.bot.on('callback_query', async (callbackQuery) => {
      const data = callbackQuery.data
      const chatId = callbackQuery.message?.chat.id
      
      if (data?.startsWith('agent_') && chatId) {
        const agentId = parseInt(data.split('_')[1])
        const agent = Object.values(this.availableAgents).find(a => a.id === agentId)
        
        if (agent) {
          this.currentAgentId = agentId
          await this.bot.editMessageText(
            `✅ Switched to: ${agent.name}\n\n${agent.description}\n\nYou can now use /ask to interact with this agent!`,
            {
              chat_id: chatId,
              message_id: callbackQuery.message?.message_id
            }
          )
        }
      }
      
      await this.bot.answerCallbackQuery(callbackQuery.id)
    })

    // Handle /help command
    this.bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id
      const currentAgent = this.getAgentName(this.currentAgentId)
      const helpText = `
📖 Multi-Agent OpenServ Bot Help:

Current Agent: ${currentAgent}

Commands:
• /start - Start the bot
• /ask [question] - Ask current agent
• /agent - Switch agents
• /agents - List all agents
• /help - Show this help message

Examples:
/ask Give information about OpenServ platform
/ask What is artificial intelligence?
/ask Can you help me with a project?
      `
      await this.bot.sendMessage(chatId, helpText)
    })

    // Error handling
    this.bot.on('polling_error', (error) => {
      console.error('Telegram polling error:', error)
    })

    console.log('✅ Telegram bot handlers set up successfully!')
  }

  private getAgentName(agentId: number): string {
    const agent = Object.values(this.availableAgents).find(a => a.id === agentId)
    return agent ? agent.name : `Agent ${agentId}`
  }

  private async getAgentResponse(workspaceId: number, agentId: number, _originalQuestion: string, timeoutMs: number = 15000): Promise<string | null> {
    const startTime = Date.now()
    const pollInterval = 2000 // Check every 2 seconds
    let attemptCount = 0
    
    console.log(`🔍 Starting to poll for agent response (timeout: ${timeoutMs}ms)`)
    
    while (Date.now() - startTime < timeoutMs) {
      attemptCount++
      console.log(`📡 Polling attempt ${attemptCount}...`)
      
      try {
        const chatMessages = await this.getChatMessages({
          workspaceId: workspaceId,
          agentId: agentId
        })
        
        console.log(`📬 Retrieved ${chatMessages?.messages?.length || 0} total messages`)
        
        if (chatMessages?.messages?.length > 0) {
          // Look for agent messages created after we started polling
          const recentAgentMessages = chatMessages.messages.filter(msg => 
            msg.author === 'agent' && 
            new Date(msg.createdAt).getTime() > startTime
          )
          
          console.log(`🤖 Found ${recentAgentMessages.length} recent agent messages`)
          
          if (recentAgentMessages.length > 0) {
            const latestResponse = recentAgentMessages[recentAgentMessages.length - 1]
            console.log(`✅ Got agent response: "${latestResponse.message.substring(0, 100)}..."`)
            return latestResponse.message
          }
        }
        
        console.log(`⏳ No response yet, waiting ${pollInterval}ms before next attempt...`)
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        
      } catch (error) {
        console.error(`❌ Error during polling attempt ${attemptCount}:`, error)
        await new Promise(resolve => setTimeout(resolve, pollInterval))
      }
    }
    
    console.log(`⏰ Timeout reached after ${attemptCount} attempts`)
    return null // Timeout reached
  }


  public async start(): Promise<void> {
    try {
      console.log('🚀 Starting Multi-Agent OpenServ Telegram Bot...')
      
      // Start the OpenServ agent server
      await super.start()
      
      console.log('✅ Multi-Agent Bot is running! Send /start to begin.')
      console.log(`📋 Available agents: ${Object.values(this.availableAgents).map(a => a.name).join(', ')}`)
      console.log(`🎯 Current agent: ${this.getAgentName(this.currentAgentId)}`)

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
