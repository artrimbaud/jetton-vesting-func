import { toNano, Cell, Address } from '@ton/core';
import { Blockchain } from '@ton/sandbox';
import { JettonMinter, jettonContentToCell } from '../wrappers/Jetton/JettonMinter';
import { SafeFactory } from '../wrappers/SafeFactory/SafeFactory';

// Blockchain
export const BLOCKCHAIN_START_TIME: number = 1000;

// Jetton
export const INITIAL_JETTON_BALANCE: bigint = toNano('1000.00');

// Vesting and Cliff data
export const VESTING_START_TIME: number = BLOCKCHAIN_START_TIME + 1000;
export const CLIFF_DURATION: number = 100;
export const VESTING_TOTAL_DURATION: number = 200;
export const UNLOCK_PERIOD: number = 10;
export const INITIALLY_UNLOCKED_PERCENTAGE: number = 10;

// Helpers
export const SOME_TIME_AFTER_VESTING_START: number = 1;

// Exit codes
export abstract class ExitCode {
    static incorrect_sender = 50;
    static already_claimed = 53;
    static transfer_not_allowed = 51;
    static only_owner_can_transfer = 401;
}

export function openContractJettonMinter(
    blockchain: Blockchain,
    jetton_sender_address: Address,
    jwallet_code: Cell,
    minter_code: Cell,
) {
    const defaultContent: Cell = jettonContentToCell({ type: 1, uri: 'https://some-url/content.json' });

    return blockchain.openContract(
        JettonMinter.createFromConfig(
            {
                admin: jetton_sender_address,
                content: defaultContent,
                wallet_code: jwallet_code,
            },
            minter_code,
        ),
    );
}

export function openContractSafeFactory(
    blockchain: Blockchain,
    safe_code: Cell,
    jetton_minter_address: Address,
    jetton_sender_address: Address,
    safe_factory_code: Cell,
    safe_type: boolean,
) {
    return blockchain.openContract(
        SafeFactory.createFromConfig(
            {
                init: 0,
                next_item_index: BigInt(0),
                safe_code: safe_code,
                safe_type: safe_type,

                jetton_wallet_address: jetton_minter_address,
                jetton_wallet_set: 0,

                creator_address: jetton_sender_address,
            },
            safe_factory_code,
        ),
    );
}

export function hasAccountCreated(events: any[]): boolean {
    return events.some(event => event.type === 'account_created');
}
