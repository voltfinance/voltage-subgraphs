import { log, BigInt, BigDecimal, Address } from '@graphprotocol/graph-ts'
import { BIG_INT_ONE } from 'const'
import { AddPool, Deposit, Harvest, Withdraw, MasterChefV4 } from '../../generated/MasterChefV4/MasterChefV4'
import { VoltageV3Pool } from '../../generated/MasterChefV4/VoltageV3Pool'
import { getOrCreateMasterChef } from '../entities/master-chef'
import { getOrCreatePool } from '../entities/pool'
import { getOrCreateUser, getOrCreateUserPosition } from '../entities/user'
import { getOrCreateToken } from '../entities/token'

export function handleAddPool(event: AddPool): void {
  log.info('[MasterChefV4] Add Pool {} {} {} {}', [
    event.params.pid.toString(),
    event.params.allocPoint.toString(),
    event.params.lmPool.toHex(),
    event.params.v3Pool.toHex(),
  ])

  let masterChef = getOrCreateMasterChef(event.address, event.block)
  let pool = getOrCreatePool(event.params.pid, event.block)

  pool.allocPoint = event.params.allocPoint
  pool.v3Pool = event.params.v3Pool

  let v3PoolContract = VoltageV3Pool.bind(event.params.v3Pool)
  let token0 = getOrCreateToken(v3PoolContract.token0())
  let token1 = getOrCreateToken(v3PoolContract.token1())

  pool.token0 = token0.id
  pool.token1 = token1.id

  pool.wfusePerSec = event.params.wfusePerSec.divDecimal(BigDecimal.fromString('1e18'))

  pool.save()

  masterChef.totalAllocPoint = masterChef.totalAllocPoint.plus(pool.allocPoint)
  masterChef.poolCount = masterChef.poolCount.plus(BIG_INT_ONE)
  masterChef.save()
}

export function handleDeposit(event: Deposit): void {
  log.info('[MasterChefV4] Log Deposit {} {} {} {}', [
    event.params.from.toHex(),
    event.params.pid.toString(),
    event.params.liquidity.toString(),
    event.params.tokenId.toString(),
  ])

  let masterChef = getOrCreateMasterChef(event.address, event.block)
  let pool = getOrCreatePool(event.params.pid, event.block)
  let user = getOrCreateUser(event.params.from, pool, event.block)
  let userPosition = getOrCreateUserPosition(event.params.tokenId, pool, event.block)

  let masterChefContract = MasterChefV4.bind(event.address)

  let voltPerSecResult = masterChefContract.try_getMasterChefV4VoltPerSec()
  if (!voltPerSecResult.reverted) {
    pool.voltPerSec = voltPerSecResult.value.divDecimal(
      BigDecimal.fromString('1e18').times(pool.allocPoint.toBigDecimal()).div(masterChef.totalAllocPoint.toBigDecimal())
    )
  }

  userPosition.tickLower = BigInt.fromI32(event.params.tickLower)
  userPosition.tickUpper = BigInt.fromI32(event.params.tickUpper)
  userPosition.liquidity = event.params.liquidity
  userPosition.isStaked = true
  userPosition.user = user.id

  userPosition.save()
  pool.save()
  user.save()
}

export function handleWithdraw(event: Withdraw): void {
  log.info('[MasterChefV4] Log Withdraw {} {} {}', [
    event.params.from.toHex(),
    event.params.to.toString(),
    event.params.pid.toString(),
    event.params.tokenId.toString(),
  ])

  let pool = getOrCreatePool(event.params.pid, event.block)
  let user = getOrCreateUser(event.params.from, pool, event.block)
  let userPosition = getOrCreateUserPosition(event.params.tokenId, pool, event.block)

  userPosition.isStaked = false

  userPosition.save()
  pool.save()
  user.save()
}

export function handleHarvest(event: Harvest): void {
  log.info('[MasterChefV4] Log Harvest {} {} {}', [
    event.params.pid.toHex(),
    event.params.reward.toString(),
    event.params.sender.toHex(),
    event.params.tokenId.toString(),
    event.params.to.toString(),
  ])

  let pool = getOrCreatePool(event.params.pid, event.block)
  let userPosition = getOrCreateUserPosition(event.params.tokenId, pool, event.block)

  userPosition.earned = userPosition.earned.plus(event.params.reward)

  userPosition.save()
}
