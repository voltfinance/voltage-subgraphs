import { Address } from "@graphprotocol/graph-ts";
import { ERC20 } from '../../generated/MasterChefV4/ERC20'
import { Token } from '../../generated/schema'

export function getOrCreateToken(address: Address): Token {
    let token = Token.load(address.toHexString())

    if (token === null) {
        token = new Token(address.toHexString())
        
        let tokenContract = ERC20.bind(address)
        
        let symbolResult = tokenContract.try_symbol()
        token.symbol = symbolResult.value

        let nameResult = tokenContract.try_name()
        token.name = nameResult.value
        
        token.decimals = tokenContract.decimals()
    }

    token.save()

    return token as Token;
}