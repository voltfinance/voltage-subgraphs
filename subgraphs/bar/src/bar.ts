import {
  ADDRESS_ZERO,
  BIG_DECIMAL_1E18,
  BIG_DECIMAL_1E6,
  BIG_DECIMAL_ZERO,
  BIG_INT_ZERO,
  VOLT_BAR_ADDRESS,
  VOLT_TOKEN_ADDRESS,
  VOLT_FUSD_PAIR_ADDRESS,
  VOLTAGE_START_BLOCK,
  BIG_DECIMAL_ONE,
} from 'const'
import { Address, BigDecimal, BigInt, dataSource, ethereum, log } from '@graphprotocol/graph-ts'
import { Bar, History, User, VoltBalanceHistory } from '../generated/schema'
import { Bar as BarContract, Transfer as TransferEvent } from '../generated/JoeBar/Bar'
import { Pair as PairContract } from '../generated/JoeBar/Pair'
import { JoeToken as JoeTokenContract } from '../generated/JoeBar/JoeToken'

// TODO: Get averages of multiple joe stablecoin pairs
function getVoltPrice(): BigDecimal {
  const pair = PairContract.bind(VOLT_FUSD_PAIR_ADDRESS)
  const reservesResult = pair.try_getReserves()
  if (reservesResult.reverted) {
    log.info('[getJoePrice] getReserves reverted', [])
    return BIG_DECIMAL_ZERO
  }
  const reserves = reservesResult.value
  if (reserves.value0.toBigDecimal().equals(BigDecimal.fromString('0'))) {
    log.error('[getJoePrice] USDC reserve 0', [])
    return BIG_DECIMAL_ZERO
  }
  return reserves.value1.toBigDecimal().times(BIG_DECIMAL_1E18).div(reserves.value0.toBigDecimal()).div(BIG_DECIMAL_1E6)
}

function createBar(block: ethereum.Block): Bar {
  const contract = BarContract.bind(dataSource.address())
  const bar = new Bar(dataSource.address().toHex())
  bar.decimals = contract.decimals()
  bar.name = contract.name()
  const barResult = contract.try_volt()
  if (barResult.reverted) {
    bar.volt = VOLT_TOKEN_ADDRESS
  } else {
    bar.volt = barResult.value
  }
  bar.symbol = contract.symbol()
  bar.totalSupply = BIG_DECIMAL_ZERO
  bar.voltStaked = BIG_DECIMAL_ZERO
  bar.voltStakedUSD = BIG_DECIMAL_ZERO
  bar.voltHarvested = BIG_DECIMAL_ZERO
  bar.voltHarvestedUSD = BIG_DECIMAL_ZERO
  bar.xVoltMinted = BIG_DECIMAL_ZERO
  bar.xVoltBurned = BIG_DECIMAL_ZERO
  bar.xVoltAge = BIG_DECIMAL_ZERO
  bar.xVoltAgeDestroyed = BIG_DECIMAL_ZERO
  bar.ratio = BIG_DECIMAL_ZERO
  bar.updatedAt = block.timestamp
  bar.voltEntered = BIG_DECIMAL_ZERO
  bar.voltExited = BIG_DECIMAL_ZERO
  bar.save()

  return bar as Bar
}

function createVoltBalanceHistory(day: string): VoltBalanceHistory {
  const vbh = new VoltBalanceHistory(day)
  vbh.balance = BIG_DECIMAL_ZERO
  vbh.balanceUSD = BIG_DECIMAL_ZERO
  vbh.totalVoltStaked = BIG_DECIMAL_ZERO
  vbh.save()

  return vbh as VoltBalanceHistory
}

function getBar(block: ethereum.Block): Bar {
  let bar = Bar.load(VOLT_BAR_ADDRESS.toHex())

  if (bar === null) {
    bar = createBar(block)
  }

  return bar as Bar
}

function getVoltBalanceHistory(block: ethereum.Block): VoltBalanceHistory {
  const day = block.timestamp.toI32() / 86400
  const id = BigInt.fromI32(day).toString()

  let vbh = VoltBalanceHistory.load(id)

  if (vbh === null) {
    vbh = createVoltBalanceHistory(id)
  }

  return vbh as VoltBalanceHistory
}

function createUser(address: Address, block: ethereum.Block): User {
  const user = new User(address.toHex())

  // Set relation to bar
  user.volt = dataSource.address().toHex()

  user.xVolt = BIG_DECIMAL_ZERO
  user.xVoltMinted = BIG_DECIMAL_ZERO
  user.xVoltBurned = BIG_DECIMAL_ZERO

  user.voltStaked = BIG_DECIMAL_ZERO
  user.voltStakedUSD = BIG_DECIMAL_ZERO

  user.voltHarvested = BIG_DECIMAL_ZERO
  user.voltHarvestedUSD = BIG_DECIMAL_ZERO

  // In/Out
  user.xVoltOut = BIG_DECIMAL_ZERO
  user.voltOut = BIG_DECIMAL_ZERO
  user.usdOut = BIG_DECIMAL_ZERO

  user.xVoltIn = BIG_DECIMAL_ZERO
  user.voltIn = BIG_DECIMAL_ZERO
  user.usdIn = BIG_DECIMAL_ZERO

  user.xVoltAge = BIG_DECIMAL_ZERO
  user.xVoltAgeDestroyed = BIG_DECIMAL_ZERO

  user.xVoltOffset = BIG_DECIMAL_ZERO
  user.voltOffset = BIG_DECIMAL_ZERO
  user.usdOffset = BIG_DECIMAL_ZERO
  user.updatedAt = block.timestamp

  return user as User
}

function getUser(address: Address, block: ethereum.Block): User {
  let user = User.load(address.toHex())

  if (user === null) {
    user = createUser(address, block)
  }

  return user as User
}

function getHistory(block: ethereum.Block): History {
  const day = block.timestamp.toI32() / 86400

  const id = BigInt.fromI32(day).toString()

  let history = History.load(id)

  if (history === null) {
    const date = day * 86400
    history = new History(id)
    history.date = date
    history.timeframe = 'Day'
    history.voltStaked = BIG_DECIMAL_ZERO
    history.voltStakedUSD = BIG_DECIMAL_ZERO
    history.voltHarvested = BIG_DECIMAL_ZERO
    history.voltHarvestedUSD = BIG_DECIMAL_ZERO
    history.xVoltAge = BIG_DECIMAL_ZERO
    history.xVoltAgeDestroyed = BIG_DECIMAL_ZERO
    history.xVoltMinted = BIG_DECIMAL_ZERO
    history.xVoltBurned = BIG_DECIMAL_ZERO
    history.xVoltSupply = BIG_DECIMAL_ZERO
    history.ratio = BIG_DECIMAL_ZERO
  }

  return history as History
}

export function transfer(event: TransferEvent): void {
  // Convert to BigDecimal with 18 places, 1e18.
  const value = event.params.value.divDecimal(BIG_DECIMAL_1E18)

  // If value is zero, do nothing.
  if (value.equals(BIG_DECIMAL_ZERO)) {
    log.warning('Transfer zero value! Value: {} Tx: {}', [
      event.params.value.toString(),
      event.transaction.hash.toHex(),
    ])
    return
  }

  const bar = getBar(event.block)
  const barContract = BarContract.bind(VOLT_BAR_ADDRESS)

  const voltPrice = getVoltPrice()

  bar.totalSupply = barContract.totalSupply().divDecimal(BIG_DECIMAL_1E18)
  bar.voltStaked = JoeTokenContract.bind(VOLT_TOKEN_ADDRESS).balanceOf(VOLT_BAR_ADDRESS).divDecimal(BIG_DECIMAL_1E18)
  bar.ratio = bar.voltStaked.div(bar.totalSupply)

  const what = value.times(bar.ratio)
  log.debug('voltPrice: {}, bar.ratio: {}, what: {}', [voltPrice.toString(), bar.ratio.toString(), what.toString()])

  // Minted xJoe
  if (event.params.from == ADDRESS_ZERO) {
    const user = getUser(event.params.to, event.block)

    log.info('{} minted {} xVolt in exchange for {} volt - voltStaked before {} voltStaked after {}', [
      event.params.to.toHex(),
      value.toString(),
      what.toString(),
      user.voltStaked.toString(),
      user.voltStaked.plus(what).toString(),
    ])

    if (user.xVolt == BIG_DECIMAL_ZERO) {
      log.info('{} entered the bar', [user.id])
      user.volt = bar.id
    }

    user.xVoltMinted = user.xVoltMinted.plus(value)

    const voltStakedUSD = what.times(voltPrice)

    user.voltStaked = user.voltStaked.plus(what)
    user.voltStakedUSD = user.voltStakedUSD.plus(voltStakedUSD)

    const days = event.block.timestamp.minus(user.updatedAt).divDecimal(BigDecimal.fromString('86400'))

    const xVoltAge = days.times(user.xVolt)

    user.xVoltAge = user.xVoltAge.plus(xVoltAge)

    // Update last
    user.xVolt = user.xVolt.plus(value)

    user.updatedAt = event.block.timestamp

    user.save()

    const barDays = event.block.timestamp.minus(bar.updatedAt).divDecimal(BigDecimal.fromString('86400'))
    const barXVolt = bar.xVoltMinted.minus(bar.xVoltBurned)
    bar.xVoltMinted = bar.xVoltMinted.plus(value)
    bar.xVoltAge = bar.xVoltAge.plus(barDays.times(barXVolt))
    bar.voltStaked = bar.voltStaked.plus(what)
    bar.voltStakedUSD = bar.voltStakedUSD.plus(voltStakedUSD)
    bar.updatedAt = event.block.timestamp
    bar.voltEntered = bar.voltEntered.plus(what)

    const history = getHistory(event.block)
    history.xVoltAge = bar.xVoltAge
    history.xVoltMinted = history.xVoltMinted.plus(value)
    history.xVoltSupply = bar.totalSupply
    history.voltStaked = history.voltStaked.plus(what)
    history.voltStakedUSD = history.voltStakedUSD.plus(voltStakedUSD)
    history.ratio = bar.ratio
    history.save()
  }

  // Burned xJoe
  if (event.params.to == ADDRESS_ZERO) {
    log.info('{} burned {} xVolt', [event.params.from.toHex(), value.toString()])

    const user = getUser(event.params.from, event.block)

    user.xVoltBurned = user.xVoltBurned.plus(value)

    user.voltHarvested = user.voltHarvested.plus(what)

    const voltHarvestedUSD = what.times(voltPrice)

    user.voltHarvestedUSD = user.voltHarvestedUSD.plus(voltHarvestedUSD)

    const days = event.block.timestamp.minus(user.updatedAt).divDecimal(BigDecimal.fromString('86400'))

    const xVoltAge = days.times(user.xVolt)

    user.xVoltAge = user.xVoltAge.plus(xVoltAge)

    const xVoltAgeDestroyed = user.xVoltAge.div(user.xVolt).times(value)

    user.xVoltAgeDestroyed = user.xVoltAgeDestroyed.plus(xVoltAgeDestroyed)

    // remove xJoeAge
    user.xVoltAge = user.xVoltAge.minus(xVoltAgeDestroyed)
    // Update xJoe last
    user.xVolt = user.xVolt.minus(value)

    if (user.xVolt == BIG_DECIMAL_ZERO) {
      log.info('{} left the bar', [user.id])
      user.volt = null
    }

    user.updatedAt = event.block.timestamp

    user.save()

    const barDays = event.block.timestamp.minus(bar.updatedAt).divDecimal(BigDecimal.fromString('86400'))
    const barXVolt = bar.xVoltMinted.minus(bar.xVoltBurned)
    bar.xVoltBurned = bar.xVoltBurned.plus(value)
    bar.xVoltAge = bar.xVoltAge.plus(barDays.times(barXVolt)).minus(xVoltAgeDestroyed)
    bar.xVoltAgeDestroyed = bar.xVoltAgeDestroyed.plus(xVoltAgeDestroyed)
    bar.voltHarvested = bar.voltHarvested.plus(what)
    bar.voltHarvestedUSD = bar.voltHarvestedUSD.plus(voltHarvestedUSD)
    bar.updatedAt = event.block.timestamp
    bar.voltExited = bar.voltExited.plus(what)

    const history = getHistory(event.block)
    history.xVoltSupply = bar.totalSupply
    history.xVoltBurned = history.xVoltBurned.plus(value)
    history.xVoltAge = bar.xVoltAge
    history.xVoltAgeDestroyed = history.xVoltAgeDestroyed.plus(xVoltAgeDestroyed)
    history.voltHarvested = history.voltHarvested.plus(what)
    history.voltHarvestedUSD = history.voltHarvestedUSD.plus(voltHarvestedUSD)
    history.ratio = bar.ratio
    history.save()
  }

  // If transfer from address to address and not known xJoe pools.
  if (event.params.from != ADDRESS_ZERO && event.params.to != ADDRESS_ZERO) {
    log.info('transfered {} xVolt from {} to {}', [
      value.toString(),
      event.params.from.toHex(),
      event.params.to.toHex(),
    ])

    const fromUser = getUser(event.params.from, event.block)

    const fromUserDays = event.block.timestamp.minus(fromUser.updatedAt).divDecimal(BigDecimal.fromString('86400'))

    // Recalc xJoe age first
    fromUser.xVoltAge = fromUser.xVoltAge.plus(fromUserDays.times(fromUser.xVolt))
    // Calculate xJoeAge being transfered
    const xVoltAgeTranfered = fromUser.xVoltAge.div(fromUser.xVolt).times(value)
    // Subtract from xJoeAge
    fromUser.xVoltAge = fromUser.xVoltAge.minus(xVoltAgeTranfered)
    fromUser.updatedAt = event.block.timestamp

    fromUser.xVolt = fromUser.xVolt.minus(value)
    fromUser.xVoltOut = fromUser.xVoltOut.plus(value)
    fromUser.voltOut = fromUser.voltOut.plus(what)
    fromUser.usdOut = fromUser.usdOut.plus(what.times(voltPrice))

    if (fromUser.xVolt == BIG_DECIMAL_ZERO) {
      log.info('{} left the bar by transfer OUT', [fromUser.id])
      fromUser.volt = null
    }

    fromUser.save()

    const toUser = getUser(event.params.to, event.block)

    if (toUser.volt === null) {
      log.info('{} entered the bar by transfer IN', [fromUser.id])
      toUser.volt = bar.id
    }

    // Recalculate xJoe age and add incoming xJoeAgeTransfered
    const toUserDays = event.block.timestamp.minus(toUser.updatedAt).divDecimal(BigDecimal.fromString('86400'))

    toUser.xVoltAge = toUser.xVoltAge.plus(toUserDays.times(toUser.xVolt)).plus(xVoltAgeTranfered)
    toUser.updatedAt = event.block.timestamp

    toUser.xVolt = toUser.xVolt.plus(value)
    toUser.xVoltIn = toUser.xVoltIn.plus(value)
    toUser.voltIn = toUser.voltIn.plus(what)
    toUser.usdIn = toUser.usdIn.plus(what.times(voltPrice))

    const difference = toUser.xVoltIn.minus(toUser.xVoltOut).minus(toUser.xVoltOffset)

    // If difference of joe in - joe out - offset > 0, then add on the difference
    // in staked joe based on xJoe:Joe ratio at time of reciept.
    if (difference.gt(BIG_DECIMAL_ZERO)) {
      const volt = toUser.voltIn.minus(toUser.voltOut).minus(toUser.voltOffset)
      const usd = toUser.usdIn.minus(toUser.usdOut).minus(toUser.usdOffset)

      log.info('{} recieved a transfer of {} xVolt from {}, volt value of transfer is {}', [
        toUser.id,
        value.toString(),
        fromUser.id,
        what.toString(),
      ])

      toUser.voltStaked = toUser.voltStaked.plus(volt)
      toUser.voltStakedUSD = toUser.voltStakedUSD.plus(usd)

      toUser.xVoltOffset = toUser.xVoltOffset.plus(difference)
      toUser.voltOffset = toUser.voltOffset.plus(volt)
      toUser.usdOffset = toUser.usdOffset.plus(usd)
    }

    toUser.save()
  }

  bar.save()
}

export function voltTransfer(event: TransferEvent): void {
  if (event.params.from != VOLT_BAR_ADDRESS && event.params.to != VOLT_BAR_ADDRESS) {
    log.warning('Ignoring tx unrelated to xVOLT Tx: {}', [
      event.transaction.hash.toHex(),
    ])
    return
  }

  const voltPrice = getVoltPrice()
  const vbh = getVoltBalanceHistory(event.block)
  const voltToken = JoeTokenContract.bind(VOLT_TOKEN_ADDRESS)
  const bar = getBar(event.block)

  vbh.balance = voltToken.balanceOf(VOLT_BAR_ADDRESS).divDecimal(BIG_DECIMAL_1E18)
  vbh.balanceUSD = vbh.balance.times(voltPrice).div(BIG_DECIMAL_1E18)
  vbh.totalVoltStaked = bar.voltEntered.minus(bar.voltExited)

  vbh.save()
}