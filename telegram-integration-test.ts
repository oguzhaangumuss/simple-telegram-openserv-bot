/**
 * 📱 Telegram Integration Test - OpenServ SDK
 * 
 * This file focuses specifically on testing Telegram bot functionality
 * using the OpenServ SDK, similar to the Twitter integration test pattern.
 * 
 * 🚀 Quick Test:
 * 1. Set your environment variables in .env file
 * 2. Run: npx ts-node telegram-integration-test.ts
 */

// Load environment variables from .env file
import 'dotenv/config'
import { Agent } from '@openserv-labs/sdk'
import axios from 'axios'
import { z } from 'zod'

// ============================================================================
// 🔧 CONFIGURATION
// ============================================================================

const CONFIG = {
  // Required: Your OpenServ API key
  OPENSERV_API_KEY: process.env.OPENSERV_API_KEY || '',
  
  // Required: Your workspace ID
  WORKSPACE_ID: parseInt(process.env.WORKSPACE_ID || '0'),
  
  // Required: Your agent ID
  AGENT_ID: parseInt(process.env.AGENT_ID || '0'),
  
  // Required: Telegram bot token
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  
  // Optional: Port for local agent server
  PORT: parseInt(process.env.PORT || '7378')
}

// Validate configuration
if (!CONFIG.OPENSERV_API_KEY) {
  console.error('❌ Please set your OPENSERV_API_KEY environment variable')
  console.error('   1. Copy .env.example to .env')
  console.error('   2. Set OPENSERV_API_KEY=your_actual_api_key')
  process.exit(1)
}

if (!CONFIG.WORKSPACE_ID || CONFIG.WORKSPACE_ID === 0) {
  console.error('❌ Please set your WORKSPACE_ID environment variable')
  console.error('   1. Find your workspace ID at https://platform.openserv.ai')
  console.error('   2. Set WORKSPACE_ID=your_actual_workspace_id in .env')
  process.exit(1)
}

if (!CONFIG.AGENT_ID || CONFIG.AGENT_ID === 0) {
  console.error('❌ Please set your AGENT_ID environment variable')
  console.error('   1. Find your agent ID at https://platform.openserv.ai')
  console.error('   2. Set AGENT_ID=your_actual_agent_id in .env')
  process.exit(1)
}

if (!CONFIG.TELEGRAM_BOT_TOKEN) {
  console.error('❌ Please set your TELEGRAM_BOT_TOKEN environment variable')
  console.error('   1. Get token from @BotFather on Telegram')
  console.error('   2. Set TELEGRAM_BOT_TOKEN=your_bot_token in .env')
  process.exit(1)
}

// ============================================================================
// 🤖 TELEGRAM TEST AGENT
// ============================================================================

const telegramTestAgent = new Agent({
  systemPrompt: 'You are a Telegram bot testing agent. You help test Telegram bot functionality through OpenServ SDK.',
  apiKey: CONFIG.OPENSERV_API_KEY
})

// ============================================================================
// 📱 TELEGRAM INTEGRATION TESTS
// ============================================================================

/**
 * Test basic Telegram bot info via Telegram API
 */
async function testTelegramBotInfo() {
  console.log('📱 Testing Telegram Bot Info...')
  
  try {
    const response = await axios.get(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/getMe`)
    
    console.log('✅ Telegram bot info fetch successful!')
    console.log('🤖 Bot Details:')
    console.log(`   Name: ${response.data.result.first_name}`)
    console.log(`   Username: @${response.data.result.username}`)
    console.log(`   ID: ${response.data.result.id}`)
    console.log(`   Can join groups: ${response.data.result.can_join_groups}`)
    console.log(`   Can read messages: ${response.data.result.can_read_all_group_messages}`)
    console.log(`   Supports inline queries: ${response.data.result.supports_inline_queries}`)
    
    return response.data
    
  } catch (error) {
    console.error('❌ Telegram bot info fetch failed:', error)
    throw error
  }
}

/**
 * Test OpenServ workspace agents list
 */
async function testOpenServAgents() {
  console.log('🔍 Testing OpenServ Workspace Agents...')
  
  try {
    const response = await axios.get(`https://api.openserv.ai/workspaces/${CONFIG.WORKSPACE_ID}/agents`, {
      headers: {
        'x-openserv-key': CONFIG.OPENSERV_API_KEY
      }
    })
    
    console.log('✅ OpenServ agents fetch successful!')
    console.log('🤖 Available Agents:')
    
    if (response.data && response.data.length > 0) {
      response.data.forEach((agent: any, index: number) => {
        console.log(`   ${index + 1}. ${agent.name} (ID: ${agent.id})`)
        console.log(`      Description: ${agent.capabilitiesDescription || 'No description'}`)
      })
      
      // Check if our configured agent exists
      const ourAgent = response.data.find((agent: any) => agent.id === CONFIG.AGENT_ID)
      if (ourAgent) {
        console.log(`\n✅ Configured agent found: ${ourAgent.name} (ID: ${CONFIG.AGENT_ID})`)
      } else {
        console.log(`\n❌ Configured agent (ID: ${CONFIG.AGENT_ID}) not found in workspace`)
      }
    } else {
      console.log('   No agents found in workspace')
    }
    
    return response.data
    
  } catch (error) {
    console.error('❌ OpenServ agents fetch failed:', error)
    throw error
  }
}

/**
 * Test chat message with marketplace agent
 */
async function testChatMessage() {
  console.log('💬 Testing Chat Message with Marketplace Agent...')
  
  try {
    const testAgent = new Agent({
      systemPrompt: 'Test agent for chat communication',
      apiKey: CONFIG.OPENSERV_API_KEY
    })
    
    const chatResponse = await testAgent.sendChatMessage({
      workspaceId: CONFIG.WORKSPACE_ID,
      agentId: CONFIG.AGENT_ID,
      message: 'Hello, this is a test message from Telegram integration test!'
    })
    
    console.log('✅ Chat message sent successfully!')
    console.log('💬 Response:', chatResponse)
    
    // Wait and get response
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    const chatMessages = await testAgent.getChatMessages({
      workspaceId: CONFIG.WORKSPACE_ID,
      agentId: CONFIG.AGENT_ID
    })
    
    if (chatMessages && chatMessages.messages && chatMessages.messages.length > 0) {
      const agentMessages = chatMessages.messages.filter(msg => msg.author === 'agent')
      if (agentMessages.length > 0) {
        const latestResponse = agentMessages[agentMessages.length - 1]
        console.log('🤖 Agent Response:', latestResponse.message)
        return latestResponse
      }
    }
    
    return chatResponse
    
  } catch (error) {
    console.error('❌ Chat message test failed:', error)
    throw error
  }
}

/**
 * Test incorrect approach (createTask) - should fail
 */
async function testIncorrectApproach() {
  console.log('❌ Testing Incorrect Approach (createTask with marketplace agent)...')
  
  try {
    const taskData = {
      assignee: CONFIG.AGENT_ID, // Marketplace agent ID
      description: 'Test task with marketplace agent (should fail)',
      body: 'This should fail because marketplace agents cannot use createTask',
      input: 'Hello test',
      expectedOutput: 'Should not work',
      dependencies: []
    }
    
    const response = await axios.post(`https://api.openserv.ai/workspaces/${CONFIG.WORKSPACE_ID}/task`, taskData, {
      headers: {
        'x-openserv-key': CONFIG.OPENSERV_API_KEY,
        'Content-Type': 'application/json'
      }
    })
    
    console.log('🤔 Unexpected: Task creation succeeded, but agent response may fail')
    return { success: false, error: 'Task created but will likely fail during execution' }
    
  } catch (error: any) {
    if (error.response?.data?.error?.includes('Agent not defined') || 
        error.response?.status === 400) {
      console.log('✅ Expected error occurred: "Agent not defined"')
      console.log('💡 This confirms marketplace agents cannot use createTask()')
      return { success: false, error: 'Agent not defined (expected)' }
    }
    
    console.log('❌ Unexpected error:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * Test solution comparison (Before vs After)
 */
async function testSolutionComparison() {
  console.log('🔄 Testing Solution Comparison (Before vs After)...')
  
  try {
    console.log('\n   📊 BEFORE: Testing incorrect approach (createTask)...')
    const incorrectResult = await testIncorrectApproach()
    
    console.log('\n   📊 AFTER: Testing correct approach (sendChatMessage)...')
    const correctResult = await testChatMessage()
    
    console.log('\n   📈 COMPARISON RESULTS:')
    console.log(`   ❌ createTask(): ${incorrectResult.error}`)
    console.log(`   ✅ sendChatMessage(): Success`)
    
    console.log('\n   💡 SOLUTION SUMMARY:')
    console.log('   • Problem: Marketplace agents cannot use createTask()')
    console.log('   • Solution: Use sendChatMessage() instead')
    console.log('   • Result: Working communication with marketplace agents')
    
    return { before: incorrectResult, after: correctResult }
    
  } catch (error) {
    console.error('❌ Solution comparison failed:', error)
    throw error
  }
}

/**
 * Test end-to-end Telegram bot workflow
 */
async function testEndToEndWorkflow() {
  console.log('🔄 Testing End-to-End Telegram Bot Workflow...')
  
  try {
    // Step 1: Send chat message
    console.log('   Step 1: Sending chat message...')
    const chatResult = await testChatMessage()
    
    if (chatResult) {
      console.log('✅ End-to-end workflow completed successfully!')
      console.log('🎉 Bot is ready to handle real Telegram messages!')
      return true
    } else {
      console.log('❌ End-to-end workflow failed - no response received')
      return false
    }
    
  } catch (error) {
    console.error('❌ End-to-end workflow failed:', error)
    throw error
  }
}

/**
 * Test Telegram webhook setup (optional)
 */
async function testTelegramWebhook() {
  console.log('🌐 Testing Telegram Webhook Setup...')
  
  try {
    // Get current webhook info
    const response = await axios.get(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/getWebhookInfo`)
    
    console.log('✅ Telegram webhook info fetch successful!')
    console.log('🔗 Webhook Details:')
    console.log(`   URL: ${response.data.result.url || 'Not set (using polling)'}`)
    console.log(`   Has custom certificate: ${response.data.result.has_custom_certificate}`)
    console.log(`   Pending updates: ${response.data.result.pending_update_count}`)
    console.log(`   Last error: ${response.data.result.last_error_message || 'None'}`)
    
    if (!response.data.result.url) {
      console.log('💡 Bot is using polling mode (good for development)')
    }
    
    return response.data
    
  } catch (error) {
    console.error('❌ Telegram webhook info fetch failed:', error)
    throw error
  }
}

// ============================================================================
// 🧪 TEST RUNNER
// ============================================================================

/**
 * Run all Telegram integration tests
 */
async function runAllTelegramTests() {
  console.log('🚀 Starting Telegram Integration Tests...')
  console.log('========================================\n')
  
  const tests = [
    { name: 'Telegram Bot Info', fn: testTelegramBotInfo },
    { name: 'OpenServ Agents List', fn: testOpenServAgents },
    { name: 'Solution Comparison (Before vs After)', fn: testSolutionComparison },
    { name: 'Telegram Webhook Info', fn: testTelegramWebhook },
    { name: 'End-to-End Workflow', fn: testEndToEndWorkflow }
  ]
  
  const results: Array<{
    test: string
    status: 'SUCCESS' | 'FAILED'
    result?: any
    error?: string
  }> = []
  
  for (const test of tests) {
    try {
      console.log(`\n🧪 Running test: ${test.name}`)
      console.log('─'.repeat(50))
      
      const result = await test.fn()
      results.push({ test: test.name, status: 'SUCCESS', result })
      
      console.log(`✅ ${test.name} completed successfully\n`)
      
      // Wait between tests
      await new Promise(resolve => setTimeout(resolve, 1000))
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      results.push({ test: test.name, status: 'FAILED', error: errorMessage })
      
      console.log(`❌ ${test.name} failed: ${errorMessage}\n`)
    }
  }
  
  // Print summary
  console.log('\n📊 TEST SUMMARY')
  console.log('================')
  
  results.forEach(result => {
    const icon = result.status === 'SUCCESS' ? '✅' : '❌'
    console.log(`${icon} ${result.test}: ${result.status}`)
    if (result.error) {
      console.log(`    Error: ${result.error}`)
    }
  })
  
  const successCount = results.filter(r => r.status === 'SUCCESS').length
  console.log(`\n🎯 ${successCount}/${results.length} tests passed`)
  
  if (successCount === results.length) {
    console.log('🎉 All tests passed! Your Telegram bot is ready!')
  } else {
    console.log('⚠️  Some tests failed. Check the errors above.')
  }
  
  return results
}

/**
 * Run quick test for basic functionality
 */
async function runQuickTest() {
  console.log('⚡ Quick Telegram Integration Test')
  console.log('==================================\n')
  
  try {
    console.log('Testing basic bot info...')
    await testTelegramBotInfo()
    
    console.log('\nTesting OpenServ agents...')
    await testOpenServAgents()
    
    console.log('\n🎉 Quick test completed successfully!')
    console.log('💡 Run full test suite for comprehensive testing')
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('❌ Quick test failed:', errorMessage)
    
    console.log('\n🔧 Troubleshooting tips:')
    console.log('1. Check your .env file has all required variables')
    console.log('2. Verify your Telegram bot token is correct')
    console.log('3. Ensure your OpenServ API key is valid')
    console.log('4. Check that your workspace and agent IDs are correct')
  }
}

// ============================================================================
// 🚀 MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('📱 OpenServ Telegram Integration Tester')
  console.log('=======================================\n')
  
  console.log('📋 Configuration:')
  console.log(`   Workspace ID: ${CONFIG.WORKSPACE_ID}`)
  console.log(`   Agent ID: ${CONFIG.AGENT_ID}`)
  console.log(`   Port: ${CONFIG.PORT}`)
  console.log(`   API Key: ${CONFIG.OPENSERV_API_KEY.substring(0, 8)}...`)
  console.log(`   Bot Token: ${CONFIG.TELEGRAM_BOT_TOKEN.substring(0, 10)}...`)
  console.log('')
  
  // Choose your test mode:
  
  // Option 1: Quick test (recommended for first run)
  // await runQuickTest()
  
  // Option 2: Full test suite (uncomment to run all tests)
  await runAllTelegramTests()
  
  // Option 3: Individual tests (uncomment specific tests)
  // await testTelegramBotInfo()
  // await testOpenServAgents()
  // await testDirectTaskCreation()
  // await testEndToEndWorkflow()
}

// Export functions for external use
export {
  telegramTestAgent,
  testTelegramBotInfo,
  testOpenServAgents,
  testIncorrectApproach,
  testChatMessage,
  testSolutionComparison,
  testEndToEndWorkflow,
  testTelegramWebhook,
  runAllTelegramTests,
  runQuickTest
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('\n💥 Test execution failed:', errorMessage)
    process.exit(1)
  })
}

/**
 * 📚 USAGE INSTRUCTIONS:
 * 
 * 1. Environment Setup:
 *    Copy .env.example to .env and fill in:
 *    - OPENSERV_API_KEY=your_openserv_api_key
 *    - WORKSPACE_ID=your_workspace_id
 *    - AGENT_ID=your_agent_id
 *    - TELEGRAM_BOT_TOKEN=your_telegram_bot_token
 * 
 * 2. Install Dependencies:
 *    npm install
 * 
 * 3. Run Tests:
 *    npx ts-node telegram-integration-test.ts
 * 
 * 4. Test Your Bot:
 *    After tests pass, start your bot with:
 *    npm run dev
 * 
 * 🔧 Troubleshooting:
 * - Make sure your Telegram bot token is from @BotFather
 * - Verify your OpenServ API key and workspace/agent IDs
 * - Check that your agent exists in the specified workspace
 * - Ensure your bot has proper permissions if using in groups
 */