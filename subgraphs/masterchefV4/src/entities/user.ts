import { BigInt, Address, ethereum } from "@graphprotocol/graph-ts";
import { BIG_INT_ONE, BIG_INT_ZERO } from "const";
import { Pool, User, UserPosition } from "../../generated/schema";

export function getOrCreateUser(address: Address, pool: Pool, block: ethereum.Block): User {  
    let uid = address.toHex();
    let user = User.load(uid);
  
    if (user === null) {
      user = new User(uid);
      user.address = address;
      pool.save();
    }
  
    user.timestamp = block.timestamp;
    user.block = block.number;
    user.save();
  
    return user as User;
}

export function getOrCreateUserPosition(tokenId: BigInt, pool: Pool, block: ethereum.Block): UserPosition {
    let uid = tokenId.toString();
    let userPosition = UserPosition.load(uid);
  
    if (userPosition === null) {
      userPosition = new UserPosition(uid);
      userPosition.pool = pool.id;
      userPosition.timestamp = block.timestamp;
      userPosition.block = block.number;
      userPosition.earned = BIG_INT_ZERO;
      userPosition.isStaked = false;
      userPosition.tickLower = BIG_INT_ZERO;
      userPosition.tickUpper = BIG_INT_ZERO;
      userPosition.liquidity = BIG_INT_ZERO;
    }
    
    userPosition.save()

    return userPosition as UserPosition;
  }
  