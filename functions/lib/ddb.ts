import { DynamoDBClient, PutItemCommand, TransactWriteItemsCommand, QueryCommand, GetItemCommand, UpdateItemCommand, DeleteItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb"

const client = new DynamoDBClient({})

export async function putItem(item: any) {
  console.log('ddb::putItem', JSON.stringify(item))
  let command = new PutItemCommand(item)
  const response = await client.send(command)
  return response
}

export async function transactWriteItems(transactItems: any[]) {
  console.log('ddb::transactWriteItems', JSON.stringify(transactItems))
  const input = {
    TransactItems: transactItems
  }
  const command = new TransactWriteItemsCommand(input)
  const response = await client.send(command)
  return response
}

export async function queryItems(queryInput: any) {
  console.log('ddb::queryItems', JSON.stringify(queryInput))
  const command = new QueryCommand(queryInput)
  const response = await client.send(command)
  return response
}

export async function getItem(getItemInput: any) {
  console.log('ddb::getItem', JSON.stringify(getItemInput))
  const command = new GetItemCommand(getItemInput)
  const response = await client.send(command)
  return response
}

export async function updateItem(updateItemInput: any) {
  console.log('ddb::updateItem', JSON.stringify(updateItemInput))
  const command = new UpdateItemCommand(updateItemInput)
  const response = await client.send(command)
  return response
}

export async function deleteItem(deleteItemInput: any) {
  console.log('ddb::deleteItem', JSON.stringify(deleteItemInput))
  const command = new DeleteItemCommand(deleteItemInput)
  const response = await client.send(command)
  return response
}

export async function scanItems(scanInput: any) {
  console.log('ddb::scanItems', JSON.stringify(scanInput))
  const command = new ScanCommand(scanInput)
  const response = await client.send(command)
  return response
}
