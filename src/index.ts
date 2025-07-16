import dotenv from 'dotenv'
import TelegramBot from 'node-telegram-bot-api'
import { Agent } from '@openserv-labs/sdk'
import { z } from 'zod'
import Tesseract from 'tesseract.js'
import sharp from 'sharp'
import crypto from 'crypto'
import { TonClient, WalletContractV4, internal, Address, beginCell, fromNano } from 'ton'
import { mnemonicToWalletKey } from 'ton-crypto'
import { getHttpEndpoint } from '@orbs-network/ton-access'

// Load environment variables
dotenv.config()

// Types for Driver License Oracle System
interface LicenseData {
  telegramId: string
  walletAddress: string
  licenseNumber: string
  licenseHash: string
  oracleResult: 'Valid' | 'Invalid' | 'Expired' | 'Processing'
  txHash: string
  timestamp: string
}

interface OCRResult {
  text: string
  confidence: number
  licenseNumber?: string
  expirationDate?: string
}

// TON Blockchain Integration
class TONIntegration {
  private client: TonClient
  private wallet: WalletContractV4 | null = null
  private keyPair: any = null
  private contractAddress: Address

  constructor() {
    // Use improved endpoint configuration with rate limit handling
    this.client = new TonClient({
      endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
      apiKey: process.env.TON_API_KEY || undefined
    })
    
    // Use user's wallet address temporarily (will be replaced with contract address)
    this.contractAddress = Address.parse("0QDvE6RYrv2gKTi7dfytJ0_vNfCVh_c5pa8Dl3v4qCzPGAAc")
    
    console.log('🔧 TON Client configured with API key:', process.env.TON_API_KEY ? 'Yes' : 'No')
  }

  async initialize(mnemonic?: string) {
    if (!mnemonic) {
      console.log('⚠️  No mnemonic provided - using demo mode')
      return false
    }

    try {
      console.log('🔧 Initializing TON wallet with mnemonic...')
      this.keyPair = await mnemonicToWalletKey(mnemonic.split(' '))
      this.wallet = WalletContractV4.create({
        publicKey: this.keyPair.publicKey,
        workchain: 0
      })
      
      console.log('✅ TON wallet initialized')
      console.log('📍 Wallet address (mainnet):', this.wallet.address.toString())
      console.log('📍 Wallet address (testnet):', this.wallet.address.toString({
        testOnly: true,
        bounceable: false
      }))
      console.log('📍 Wallet address (testnet bounceable):', this.wallet.address.toString({
        testOnly: true,
        bounceable: true
      }))
      
      // Check different wallet versions
      console.log('\n🔍 Checking different wallet versions:')
      console.log('V4 (current):', this.wallet.address.toString({
        testOnly: true,
        bounceable: false
      }))
      
      // Test connection
      console.log('🔍 Testing connection to TON network...')
      try {
        const masterchainInfo = await this.client.getMasterchainInfo()
        console.log('📦 Latest seqno:', masterchainInfo.latestSeqno)
      } catch (error) {
        console.log('⚠️  Could not get masterchain info:', error)
      }
      
      return true
    } catch (error) {
      console.error('❌ TON wallet initialization failed:', error)
      console.error('Error details:', error instanceof Error ? error.message : error)
      return false
    }
  }

  async recordLicenseVerification(licenseData: LicenseData): Promise<string | null> {
    if (!this.wallet || !this.keyPair) {
      console.log('❌ TON wallet not initialized - cannot record to blockchain')
      return null
    }

    try {
      console.log('⛓️  Recording license verification on TON blockchain...')
      
      // Create message payload
      const message = beginCell()
        .storeUint(0, 32) // op code for license verification
        .storeBuffer(Buffer.from(licenseData.licenseHash, 'hex').slice(0, 32))
        .storeUint(this.getOracleResultCode(licenseData.oracleResult), 8)
        .storeUint(Date.now(), 64)
        .storeStringTail(licenseData.telegramId)
        .endCell()

      // Create internal transfer
      const transfer = internal({
        to: this.contractAddress,
        value: '0.01', // 0.01 TON for gas
        body: message
      })

      // Get wallet sequence number
      const contract = this.client.open(this.wallet)
      const seqno = await contract.getSeqno()
      
      console.log(`📊 Current wallet seqno: ${seqno}`)
      
      // Create and send transaction
      const transaction = await this.wallet.createTransfer({
        seqno,
        secretKey: this.keyPair.secretKey,
        messages: [transfer]
      })

      console.log('📤 Sending transaction to TON network...')
      await contract.send(transaction)
      
      // Wait for transaction confirmation
      console.log('⏳ Waiting for transaction confirmation...')
      const confirmedTx = await this.waitForTransaction(seqno, 60000) // Wait up to 60 seconds
      
      if (confirmedTx) {
        console.log('✅ Transaction confirmed on TON blockchain')
        console.log('🔗 Real transaction hash:', confirmedTx.hash)
        return confirmedTx.hash
      } else {
        console.log('⚠️  Transaction confirmation timeout')
        return null
      }
      
    } catch (error) {
      console.error('❌ TON blockchain recording failed:', error)
      return null
    }
  }

  private getOracleResultCode(result: string): number {
    switch (result) {
      case 'Valid': return 1
      case 'Expired': return 2
      case 'Invalid': return 3
      default: return 0
    }
  }


  async getWalletBalance(): Promise<string> {
    if (!this.wallet) {
      console.log('❌ Wallet not initialized')
      return '0'
    }
    
    try {
      console.log('🔍 Checking wallet deployment status...')
      const isDeployed = await this.client.isContractDeployed(this.wallet.address)
      
      if (!isDeployed) {
        console.log('⚠️  Wallet contract not deployed yet')
        return '0 TON (not deployed)'
      }
      
      console.log('✅ Wallet is deployed, getting balance...')
      const balance = await this.client.getBalance(this.wallet.address)
      const balanceInTon = fromNano(balance)
      
      console.log(`💰 Raw balance: ${balance}, Converted: ${balanceInTon}`)
      console.log(`📍 Wallet address: ${this.wallet.address.toString()}`)
      
      return balanceInTon + ' TON'
    } catch (error: any) {
      console.error('❌ Failed to get wallet balance:', error)
      
      // Handle rate limiting specifically
      if (error.response?.status === 429) {
        console.error('⏰ Rate limited by TON API')
        console.error('💡 Suggestion: Get API key from @tonapibot on Telegram')
        return '0 TON (rate limited)'
      }
      
      console.error('Error details:', error instanceof Error ? error.message : error)
      return '0'
    }
  }

  async waitForTransaction(seqno: number, timeoutMs: number = 60000): Promise<{hash: string} | null> {
    const startTime = Date.now()
    const contract = this.client.open(this.wallet!)
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const currentSeqno = await contract.getSeqno()
        
        if (currentSeqno > seqno) {
          // Transaction was processed, now get the transaction details
          console.log(`📊 Seqno updated: ${seqno} -> ${currentSeqno}`)
          
          // Get transactions from the wallet
          const transactions = await this.client.getTransactions(this.wallet!.address, {
            limit: 10
          })
          
          // Find the transaction with our seqno
          for (const tx of transactions) {
            if (tx.inMessage && tx.inMessage.info.type === 'internal') {
              const txHash = tx.hash().toString('hex')
              console.log(`🔍 Found transaction: ${txHash}`)
              return { hash: txHash }
            }
          }
          
          // If we can't find the specific transaction, return the first one
          if (transactions.length > 0) {
            const txHash = transactions[0].hash().toString('hex')
            console.log(`🔍 Using latest transaction: ${txHash}`)
            return { hash: txHash }
          }
        }
        
        console.log(`⏳ Waiting for confirmation... (seqno: ${seqno}, current: ${currentSeqno || 'unknown'})`)
        await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2 seconds
        
      } catch (error) {
        console.error('❌ Error while waiting for transaction:', error)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
    
    console.log('⏰ Transaction confirmation timeout')
    return null
  }

  async debugWalletState(): Promise<void> {
    if (!this.wallet) {
      console.log('❌ Wallet not initialized for debug')
      return
    }

    try {
      console.log('🔍 === TON Wallet Debug Information ===')
      console.log('📍 Wallet address:', this.wallet.address.toString())
      console.log('📍 Testnet address:', this.wallet.address.toString({
        testOnly: true,
        bounceable: false
      }))
      
      // Check if contract is deployed
      const isDeployed = await this.client.isContractDeployed(this.wallet.address)
      console.log('📦 Contract deployed:', isDeployed)
      
      // Get balance
      const balance = await this.client.getBalance(this.wallet.address)
      console.log('💰 Balance (nanoTON):', balance.toString())
      console.log('💰 Balance (TON):', fromNano(balance))
      
      // Check contract state
      const contractState = await this.client.getContractState(this.wallet.address)
      console.log('📊 Contract state:', contractState.state)
      
      // Get last block info
      try {
        const masterchainInfo = await this.client.getMasterchainInfo()
        console.log('📦 Network latest seqno:', masterchainInfo.latestSeqno)
      } catch (error) {
        console.log('⚠️  Could not get masterchain info:', error)
      }
      
      console.log('🔍 === End Debug Information ===')
    } catch (error) {
      console.error('❌ Debug failed:', error)
    }
  }
}

class SimpleTelegramBot extends Agent {
  private bot: TelegramBot
  private workspaceId: number
  private currentAgentId: number
  private availableAgents: Record<string, { id: number, name: string, description: string }>
  private licenseDatabase: Map<string, LicenseData>
  private tonIntegration: TONIntegration
  private userWallets: Map<string, string> // telegramId -> walletAddress (NO MNEMONIC)

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
    
    // Initialize license database
    this.licenseDatabase = new Map<string, LicenseData>()
    
    // Initialize user wallets
    this.userWallets = new Map<string, string>()
    
    // Initialize TON integration
    this.tonIntegration = new TONIntegration()

    this.setupHandlers()
  }


  private setupHandlers() {
    // Handle /start command
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id
      const currentAgent = this.getAgentName(this.currentAgentId)
      const startMessage = `🤖 Multi-Agent OpenServ Bot + License Oracle!

Current Agent: ${currentAgent}

🤖 AI Commands:
• /ask [question] - Ask current agent
• /agent - Switch agents
• /agents - List all agents

🆔 License Oracle:
• /setwallet EQCx...YtR9 - Set your TON wallet address
• Send photo - Upload license for verification
• /license - Check status
• /licenses - View all
• /export - Export Excel format

⛓️ TON Blockchain:
• /wallet - Check wallet & blockchain status

📸 Upload your license photo to get started!
Example: /ask What is OpenServ?`

      await this.bot.sendMessage(chatId, startMessage)
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
📖 Multi-Agent OpenServ Bot + License Oracle Help:

Current Agent: ${currentAgent}

🤖 AI Commands:
• /start - Start the bot
• /ask [question] - Ask current agent
• /agent - Switch agents
• /agents - List all agents

🆔 License Oracle Commands:
• /setwallet EQCx...YtR9 - Set your TON wallet address
• Send photo - Upload license image for OCR processing
• /license - Check your license status
• /licenses - View all processed licenses
• /export - Export data in Excel format

⛓️  TON Blockchain Commands:
• /wallet - Show TON wallet status and balance

• /help - Show this help message

Examples:
/ask Give information about OpenServ platform
/ask What is artificial intelligence?
/ask Can you help me with a project?

📸 To verify a license: Just send a photo of the license!
      `
      await this.bot.sendMessage(chatId, helpText)
    })

    // Handle photo uploads for license verification
    this.bot.on('photo', async (msg) => {
      const chatId = msg.chat.id
      const telegramId = msg.from?.username || msg.from?.id.toString() || 'unknown'
      
      console.log(`📸 Photo received from user: ${telegramId}`)
      
      try {
        // Send processing message
        await this.bot.sendMessage(chatId, '📸 Processing license image...')
        
        // Get the highest resolution photo
        if (!msg.photo || msg.photo.length === 0) {
          await this.bot.sendMessage(chatId, '❌ No photo received')
          return
        }
        
        const photo = msg.photo[msg.photo.length - 1]
        const fileId = photo.file_id
        
        // Download the photo
        const fileLink = await this.bot.getFileLink(fileId)
        const response = await fetch(fileLink)
        const imageBuffer = Buffer.from(await response.arrayBuffer())
        
        console.log(`💾 Image downloaded, size: ${imageBuffer.length} bytes`)
        
        // Process with OCR
        const ocrResult = await this.processLicenseImage(imageBuffer)
        
        if (ocrResult.licenseNumber) {
          // Check if user has set wallet address
          const userWallet = this.userWallets.get(telegramId)
          if (!userWallet) {
            await this.bot.sendMessage(chatId, '❌ Please set your TON wallet address first: /setwallet EQCx...YtR9')
            return
          }
          
          // Generate license hash
          console.log('\n🚀 ===== STARTING BLOCKCHAIN PROCESS =====')
          console.log(`📸 Processing license for user: ${telegramId}`)
          console.log(`🔍 Extracted License Number: ${ocrResult.licenseNumber}`)
          console.log(`💰 User Wallet: ${userWallet}`)
          
          const licenseHash = this.generateLicenseHash(ocrResult.licenseNumber, telegramId, userWallet)
          
          // Run Oracle verification
          const oracleResult = await this.mockOracleVerification(ocrResult.licenseNumber)
          console.log(`🔮 Oracle Result: ${oracleResult}`)
          
          // Create license data first
          const licenseData: LicenseData = {
            telegramId,
            walletAddress: userWallet,
            licenseNumber: ocrResult.licenseNumber,
            licenseHash,
            oracleResult,
            txHash: '', // Will be set below
            timestamp: new Date().toISOString()
          }
          
          // Record on TON blockchain (real blockchain transaction)
          const txHash = await this.tonIntegration.recordLicenseVerification(licenseData)
          if (txHash) {
            licenseData.txHash = txHash
          } else {
            console.log('❌ Failed to record license on blockchain')
            await this.bot.sendMessage(chatId, '❌ Failed to record license on blockchain. Please try again or contact support.')
            return
          }
          
          console.log('\n📊 ===== DEMO BLOCKCHAIN SUMMARY =====')
          console.log(`👤 Telegram ID: @${telegramId}`)
          console.log(`💰 Wallet Address: ${userWallet}`)
          console.log(`📋 License Number: ${ocrResult.licenseNumber}`)
          console.log(`🔑 License Hash: 0x${licenseHash.substring(0, 8)}...${licenseHash.substring(-4)}`)
          console.log(`🔮 Oracle Result: ${oracleResult === 'Valid' ? '✅' : oracleResult === 'Expired' ? '⏰' : '❌'} ${oracleResult}`)
          console.log(`📦 TON Tx Hash: ${txHash ? txHash.substring(0, 16) + '...' : 'Error generating hash'}`)
          console.log(`🕒 Timestamp: ${new Date().toISOString()}`)
          console.log('📊 ===================================\n')
          
          await this.saveLicenseData(licenseData)
          
          // Send result to user
          const resultIcon = oracleResult === 'Valid' ? '✅' : oracleResult === 'Expired' ? '⏰' : '❌'
          const resultMessage = `
🆔 License Processing Complete

📋 Results:
• License Number: ${ocrResult.licenseNumber}
• Oracle Status: ${resultIcon} ${oracleResult}
• Confidence: ${ocrResult.confidence.toFixed(2)}%
• Hash: ${licenseHash.substring(0, 16)}...

${ocrResult.expirationDate ? `• Expiration: ${ocrResult.expirationDate}` : ''}

⛓️  Blockchain:
• TON Status: ${txHash ? 'Recorded' : 'Demo Mode'}
${txHash ? `• Tx Hash: ${txHash.substring(0, 16)}...` : ''}

          `
          
          await this.bot.sendMessage(chatId, resultMessage)
          
        } else {
          await this.bot.sendMessage(chatId, `❌ Could not extract license number from image.\n\nOCR Text:\n${ocrResult.text.substring(0, 300)}...`)
        }
        
      } catch (error) {
        console.error('❌ License processing error:', error)
        await this.bot.sendMessage(chatId, '❌ Error processing license image. Please try again.')
      }
    })

    // Handle /license command - Show license status
    this.bot.onText(/\/license/, async (msg) => {
      const chatId = msg.chat.id
      const telegramId = msg.from?.username || msg.from?.id.toString() || 'unknown'
      
      const licenseData = this.licenseDatabase.get(telegramId)
      
      if (licenseData) {
        const resultIcon = licenseData.oracleResult === 'Valid' ? '✅' : licenseData.oracleResult === 'Expired' ? '⏰' : '❌'
        const statusMessage = `
🆔 Your License Status

📋 Information:
• License Number: ${licenseData.licenseNumber}
• Status: ${resultIcon} ${licenseData.oracleResult}
• Hash: ${licenseData.licenseHash.substring(0, 16)}...
• Processed: ${new Date(licenseData.timestamp).toLocaleString()}

${licenseData.walletAddress ? `• Wallet: ${licenseData.walletAddress}` : ''}
${licenseData.txHash ? `• Tx Hash: ${licenseData.txHash}` : ''}
        `
        
        await this.bot.sendMessage(chatId, statusMessage)
      } else {
        await this.bot.sendMessage(chatId, `❌ No license data found. Please upload your license photo first.`)
      }
    })

    // Handle /licenses command - Show all licenses (admin)
    this.bot.onText(/\/licenses/, async (msg) => {
      const chatId = msg.chat.id
      
      if (this.licenseDatabase.size === 0) {
        await this.bot.sendMessage(chatId, '📋 No licenses processed yet.')
        return
      }
      
      let licensesList = '📋 All Processed Licenses:\n\n'
      
      for (const [telegramId, licenseData] of this.licenseDatabase) {
        const resultIcon = licenseData.oracleResult === 'Valid' ? '✅' : licenseData.oracleResult === 'Expired' ? '⏰' : '❌'
        licensesList += `• ${telegramId}: ${licenseData.licenseNumber} ${resultIcon}\n`
      }
      
      await this.bot.sendMessage(chatId, licensesList)
    })

    // Handle /export command - Export license data in Excel format
    this.bot.onText(/\/export/, async (msg) => {
      const chatId = msg.chat.id
      
      if (this.licenseDatabase.size === 0) {
        await this.bot.sendMessage(chatId, '📋 No license data to export.')
        return
      }
      
      let csvContent = 'Telegram ID,Wallet Address (TON),License Number,License Hash (SHA-256),Oracle Result,Tx Hash (TON),Timestamp\n'
      
      for (const [telegramId, licenseData] of this.licenseDatabase) {
        const resultIcon = licenseData.oracleResult === 'Valid' ? '✅ Valid' : 
                          licenseData.oracleResult === 'Expired' ? '❌ Expired' : 
                          '❌ Invalid'
        
        csvContent += `@${telegramId},${licenseData.walletAddress},${licenseData.licenseNumber},0x${licenseData.licenseHash.substring(0, 8)}...${licenseData.licenseHash.substring(-4)},${resultIcon},${licenseData.txHash.substring(0, 16)}...,${new Date(licenseData.timestamp).toLocaleString()}\n`
      }
      
      // Send as formatted table
      const tableFormat = `
📊 Driver License Oracle TON - Export Data

\`\`\`
Telegram ID    Wallet Address (TON)    License Number    License Hash (SHA-256)    Oracle Result    Tx Hash (TON)    Timestamp
${Array.from(this.licenseDatabase.entries()).map(([telegramId, data]) => {
        const resultIcon = data.oracleResult === 'Valid' ? '✅ Valid' : 
                          data.oracleResult === 'Expired' ? '⏰ Expired' : 
                          '❌ Invalid'
        return `@${telegramId}    ${data.walletAddress.substring(0, 6)}...${data.walletAddress.substring(-4)}    ${data.licenseNumber}    0x${data.licenseHash.substring(0, 8)}...${data.licenseHash.substring(-4)}    ${resultIcon}    ${data.txHash.substring(0, 16)}...    ${new Date(data.timestamp).toLocaleDateString()}`
      }).join('\n')}
\`\`\`

💾 Total Records: ${this.licenseDatabase.size}
⛓️  All transactions recorded on TON Testnet
      `
      
      await this.bot.sendMessage(chatId, tableFormat)
    })

    // Handle /setwallet command - Set user's TON wallet address
    this.bot.onText(/\/set\s*wallet\s+(.+)/i, async (msg, match) => {
      const chatId = msg.chat.id
      const telegramId = msg.from?.username || msg.from?.id.toString() || 'unknown'
      const walletAddress = match?.[1]?.trim()
      
      console.log(`🔧 /setwallet command received from ${telegramId}`)
      console.log(`🔧 Raw message text: "${msg.text}"`)
      console.log(`🔧 Wallet address: ${walletAddress}`)
      console.log(`🔧 Match array:`, match)
      
      if (!walletAddress) {
        await this.bot.sendMessage(chatId, '❌ Please provide a TON wallet address: /setwallet EQCx...YtR9')
        return
      }
      
      try {
        // Basic validation for TON address format
        if (!walletAddress.match(/^(EQ|UQ|0Q)[A-Za-z0-9_-]{46}$/)) {
          await this.bot.sendMessage(chatId, '❌ Invalid TON wallet address format')
          return
        }
        
        // Save wallet address
        this.userWallets.set(telegramId, walletAddress)
        
        // Demo terminal output
        console.log('\n💰 ===== WALLET REGISTRATION =====')
        console.log(`👤 Telegram ID: @${telegramId}`)
        console.log(`📍 TON Wallet: ${walletAddress}`)
        console.log(`🔗 Network: TON Testnet`)
        console.log(`🕒 Registered: ${new Date().toISOString()}`)
        console.log(`✅ Status: Ready for license verification`)
        console.log('💰 ===============================\n')
        
        await this.bot.sendMessage(chatId, `✅ TON wallet address set successfully!

📍 Address: ${walletAddress}
👤 Telegram ID: @${telegramId}
💡 Now you can upload license photos for verification`)
      } catch (error) {
        console.error('❌ Error setting wallet:', error)
        await this.bot.sendMessage(chatId, '❌ Error setting wallet address')
      }
    })

    // Handle /wallet command - Show TON wallet info
    this.bot.onText(/\/wallet/, async (msg) => {
      const chatId = msg.chat.id
      
      try {
        // Run debug first to get detailed information
        await this.tonIntegration.debugWalletState()
        
        const balance = await this.tonIntegration.getWalletBalance()
        const isActive = balance !== '0' && !balance.startsWith('0.0000') && !balance.includes('not deployed')
        const statusIcon = isActive ? '🟢' : '🔵'
        const statusText = isActive ? 'Blockchain Recording Active' : 'Blockchain Recording Ready'
        
        const walletInfo = `
⛓️  TON Blockchain Integration

${statusIcon} ${statusText}
💰 Balance: ${balance}
🌐 Network: Testnet
📊 Recorded Licenses: ${this.licenseDatabase.size}

✨ All license verifications are securely recorded on the blockchain for transparency and immutability.

🔍 Debug: Check logs for detailed wallet information
        `
        
        await this.bot.sendMessage(chatId, walletInfo)
      } catch (error) {
        console.error('❌ Wallet info error:', error)
        await this.bot.sendMessage(chatId, '❌ Could not get wallet information')
      }
    })

    // Debug: Log all messages
    this.bot.on('message', (msg) => {
      console.log(`📨 Message received: "${msg.text}" from ${msg.from?.username || msg.from?.id}`)
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

  // OCR Methods for License Processing
  private async processLicenseImage(imageBuffer: Buffer): Promise<OCRResult> {
    console.log('📸 Starting license image processing...')
    
    try {
      // Process image with Sharp (enhance for better OCR)
      const processedImage = await sharp(imageBuffer)
        .resize(800, null, { withoutEnlargement: false }) // Upscale for better OCR
        .grayscale()
        .normalize()
        .sharpen()
        .gamma(1.2) // Improve contrast
        .png()
        .toBuffer()
      
      console.log('🔍 Running OCR on processed image...')
      
      // Run OCR with Tesseract
      const { data } = await Tesseract.recognize(processedImage, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            const progress = Math.round(m.progress * 100)
            console.log(`OCR Progress: ${progress}%`)
          }
        }
      })
      
      console.log('📝 OCR completed, extracting license info...')
      
      // Clean and format the OCR text
      const cleanedText = this.cleanOCRText(data.text)
      
      // Extract license information
      const licenseNumber = this.extractLicenseNumber(cleanedText)
      const expirationDate = this.extractExpirationDate(cleanedText)
      
      return {
        text: cleanedText,
        confidence: data.confidence,
        licenseNumber,
        expirationDate
      }
      
    } catch (error) {
      console.error('❌ OCR processing failed:', error)
      throw error
    }
  }

  private extractLicenseNumber(text: string): string | undefined {
    // Enhanced license number patterns for better extraction
    const patterns = [
      /(?:DL|LICENSE|LIC)[\s#:]*([A-Z]?\d{7,8})/gi,  // DL: A1234567 or DL 01234567
      /(?:^|\s)([A-Z]\d{7})(?=\s|$)/gm,              // A1234567 format standalone
      /(?:^|\s)([A-Z]{2}\d{6})(?=\s|$)/gm,           // AB123456 format standalone  
      /(?:^|\s)(\d{8})(?=\s|$)/gm,                   // 12345678 format standalone
      /(?:^|\s)([A-Z]\d{6})(?=\s|$)/gm,              // A123456 format standalone
      /\b(\d{8})\b/g,                               // Any 8-digit number
      /\b([A-Z]\d{7})\b/g                           // Any letter + 7 digits
    ]
    
    for (const pattern of patterns) {
      const matches = text.match(pattern)
      if (matches && matches.length > 0) {
        // Clean the match (remove prefixes like DL:, LICENSE:)
        let licenseNumber = matches[0].replace(/^(?:DL|LICENSE|LIC)[\s#:]*/i, '').trim()
        console.log(`🔍 Found license number: ${licenseNumber}`)
        return licenseNumber
      }
    }
    
    console.log('❌ No license number found in OCR text')
    console.log('🔍 OCR text for debugging:', text.substring(0, 200))
    return undefined
  }

  private extractExpirationDate(text: string): string | undefined {
    // Common date patterns
    const patterns = [
      /\d{2}\/\d{2}\/\d{4}/g,     // MM/DD/YYYY
      /\d{2}-\d{2}-\d{4}/g,       // MM-DD-YYYY
      /\d{4}-\d{2}-\d{2}/g,       // YYYY-MM-DD
      /\d{2}\.\d{2}\.\d{4}/g,     // MM.DD.YYYY
    ]
    
    for (const pattern of patterns) {
      const matches = text.match(pattern)
      if (matches && matches.length > 0) {
        console.log(`📅 Found expiration date: ${matches[0]}`)
        return matches[0]
      }
    }
    
    console.log('❌ No expiration date found in OCR text')
    return undefined
  }

  private generateLicenseHash(licenseNumber: string, telegramId: string, userWalletAddress: string): string {
    const timestamp = Date.now()
    const data = `${licenseNumber}_${telegramId}_${userWalletAddress}_${timestamp}`
    const hash = crypto.createHash('sha256').update(data).digest('hex')
    
    // Terminal output for demo
    console.log('\n🔐 ===== BLOCKCHAIN HASH GENERATION =====')
    console.log(`📋 License Number: ${licenseNumber}`)
    console.log(`👤 Telegram ID: ${telegramId}`)
    console.log(`💰 User Wallet: ${userWalletAddress}`)
    console.log(`🕒 Timestamp: ${new Date().toISOString()}`)
    console.log(`🔑 Input Data: ${data}`)
    console.log(`🔗 SHA-256 Hash: ${hash}`)
    console.log(`📊 Hash Preview: 0x${hash.substring(0, 16)}...${hash.substring(-8)}`)
    console.log('🔐 =====================================\n')
    
    return hash
  }


  private async saveLicenseData(licenseData: LicenseData): Promise<void> {
    this.licenseDatabase.set(licenseData.telegramId, licenseData)
    
    // Demo terminal table output
    console.log('\n📊 ===== UPDATED LICENSE DATABASE =====')
    console.log('Telegram ID       | Wallet Address    | License Number | License Hash      | Oracle Result | Tx Hash          | Timestamp')
    console.log('------------------|-------------------|----------------|-------------------|---------------|------------------|------------------')
    
    for (const [telegramId, data] of this.licenseDatabase) {
      const resultIcon = data.oracleResult === 'Valid' ? '✅' : data.oracleResult === 'Expired' ? '⏰' : '❌'
      const formattedRow = `@${telegramId.padEnd(15)} | ${data.walletAddress.substring(0, 6)}...${data.walletAddress.substring(-4).padEnd(9)} | ${data.licenseNumber.padEnd(14)} | 0x${data.licenseHash.substring(0, 8)}...${data.licenseHash.substring(-4).padEnd(7)} | ${resultIcon} ${data.oracleResult.padEnd(7)} | ${data.txHash.substring(0, 16)}... | ${new Date(data.timestamp).toLocaleDateString()}`
      console.log(formattedRow)
    }
    
    console.log('📊 ===================================\n')
  }

  private cleanOCRText(text: string): string {
    return text
      .replace(/[|~]/g, '') // Remove vertical bars and tildes
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/\n\s*\n/g, '\n') // Remove empty lines
      .trim()
  }


  private async mockOracleVerification(licenseNumber: string): Promise<'Valid' | 'Invalid' | 'Expired'> {
    console.log(`🔮 Running Oracle verification for license: ${licenseNumber}`)
    
    // Mock verification logic (replace with real Oracle later)
    const lastDigit = licenseNumber.slice(-1)
    const digit = parseInt(lastDigit)
    
    if (digit % 3 === 0) {
      return 'Valid'
    } else if (digit % 3 === 1) {
      return 'Expired'
    } else {
      return 'Invalid'
    }
  }


  public async start(): Promise<void> {
    try {
      console.log('🚀 Starting Multi-Agent OpenServ Telegram Bot...')
      
      // Initialize TON integration
      const tonMnemonic = process.env.TON_MNEMONIC
      console.log('🔧 Reading TON_MNEMONIC from env...')
      console.log('🔧 Mnemonic exists:', !!tonMnemonic)
      console.log('🔧 Mnemonic length:', tonMnemonic?.split(' ').length || 0)
      if (tonMnemonic) {
        console.log('🔧 First 3 words:', tonMnemonic.split(' ').slice(0, 3).join(' '))
      }
      const tonInitialized = await this.tonIntegration.initialize(tonMnemonic)
      
      // Start the OpenServ agent server
      await super.start()
      
      console.log('✅ Multi-Agent Bot is running! Send /start to begin.')
      console.log(`📋 Available agents: ${Object.values(this.availableAgents).map(a => a.name).join(', ')}`)
      console.log(`🎯 Current agent: ${this.getAgentName(this.currentAgentId)}`)
      console.log(`⛓️  TON Blockchain: ${tonInitialized ? 'Active' : 'Demo Mode'}`)

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
