import { BigInt, log } from '@graphprotocol/graph-ts'
import { FACTORY_ADDRESS, BIG_DECIMAL_1E18, BIG_INT_ONE } from 'const'
import { getVoltPrice } from '../../../../packages/pricing'
import { getMaker, getServer, getServingDayData } from '../entities'
import { Serving } from '../../generated/schema'
import { Factory as FactoryContract } from '../../generated/VoltMakerV2/Factory'
import { ERC20 as ERC20Contract } from '../../generated/VoltMakerV2/ERC20'
import { LogConvert } from '../../generated/VoltMakerV2/VoltMakerV2'

export function handleLogConvert(event: LogConvert): void {
  log.info('[JoeMaker] Log Convert {} {} {} {} {} {}', [
    event.params.server.toHex(),
    event.params.token0.toHex(),
    event.params.token1.toHex(),
    event.params.amount0.toString(),
    event.params.amount1.toString(),
    event.params.amountVOLT.toString(),
  ])

  const maker = getMaker(event.block)
  const server = getServer(event.params.server, event.block)

  const voltAmount = event.params.amountVOLT.toBigDecimal().div(BIG_DECIMAL_1E18)
  const voltAmountUSD = voltAmount.times(getVoltPrice(event.block))

  const token0Contract = ERC20Contract.bind(event.params.token0)
  const token0SymbolResult = token0Contract.try_symbol()
  const token0Symbol = token0SymbolResult.reverted ? '' : token0SymbolResult.value
  const token0DecimalsResult = token0Contract.try_decimals()
  const token0Decimals = token0DecimalsResult.reverted ? 1 : token0DecimalsResult.value

  const token1Contract = ERC20Contract.bind(event.params.token1)
  const token1SymbolResult = token1Contract.try_symbol()
  const token1Symbol = token1SymbolResult.reverted ? '' : token1SymbolResult.value
  const token1DecimalsResult = token1Contract.try_decimals()
  const token1Decimals = token1DecimalsResult.reverted ? 1 : token1DecimalsResult.value

  const factoryContract = FactoryContract.bind(FACTORY_ADDRESS)
  const pair = factoryContract.getPair(event.params.token0, event.params.token1)

  const id = pair.toHex().concat('-').concat(event.block.number.toString())
  let serving = new Serving(id)

  serving.maker = maker.id
  serving.server = server.id
  serving.tx = event.transaction.hash
  serving.token0 = event.params.token0
  serving.token1 = event.params.token1
  serving.token0Symbol = token0Symbol
  serving.token1Symbol = token1Symbol
  serving.amount0 = event.params.amount0.toBigDecimal().div(BigInt.fromI32(token0Decimals).toBigDecimal())
  serving.amount1 = event.params.amount1.toBigDecimal().div(BigInt.fromI32(token1Decimals).toBigDecimal())
  serving.voltServed = voltAmount
  serving.voltServedUSD = voltAmountUSD
  serving.block = event.block.number
  serving.timestamp = event.block.timestamp
  serving.save()

  const servingDayData = getServingDayData(event)
  servingDayData.voltServed = servingDayData.voltServed.plus(voltAmount)
  servingDayData.voltServedUSD = servingDayData.voltServedUSD.plus(voltAmountUSD)
  servingDayData.totalServings = servingDayData.totalServings.plus(BIG_INT_ONE)
  servingDayData.save()

  serving.dayData = servingDayData.id
  serving.save()

  maker.voltServed = maker.voltServed.plus(voltAmount)
  maker.voltServedUSD = maker.voltServedUSD.plus(voltAmountUSD)
  maker.totalServings = maker.totalServings.plus(BIG_INT_ONE)
  maker.save()

  server.voltServed = server.voltServed.plus(voltAmount)
  server.voltServedUSD = server.voltServedUSD.plus(voltAmountUSD)
  server.totalServings = server.totalServings.plus(BIG_INT_ONE)
  server.save()
}
