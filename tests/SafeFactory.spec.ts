import { Blockchain, SandboxContract, TreasuryContract, SendMessageResult } from '@ton/sandbox';
import { Cell, toNano, beginCell, Address } from '@ton/core';

import { Safe } from '../wrappers/Safe/Safe';
import { SafeFactory } from '../wrappers/SafeFactory/SafeFactory';

import { compile } from '@ton/blueprint';

import '@ton/test-utils';

import { JettonWallet } from '../wrappers/Jetton/JettonWallet';
import { JettonMinter } from '../wrappers/Jetton/JettonMinter';

// Import constants
import {
    BLOCKCHAIN_START_TIME,
    INITIAL_JETTON_BALANCE,
    VESTING_START_TIME,
    CLIFF_DURATION,
    VESTING_TOTAL_DURATION,
    UNLOCK_PERIOD,
    INITIALLY_UNLOCKED_PERCENTAGE,
    SOME_TIME_AFTER_VESTING_START,
    ExitCode,
    openContractJettonMinter,
    openContractSafeFactory,
} from './SafeFactoryUtils';

describe('Blockchain ', () => {
    // Blockchain
    let blockchain: Blockchain;

    // Jetton
    let jetton_sender: SandboxContract<TreasuryContract>;
    let jetton_receiver: SandboxContract<TreasuryContract>;
    let not_jetton_receiver: SandboxContract<TreasuryContract>;

    let jettonUserWallet: (address: Address) => Promise<SandboxContract<JettonWallet>>;

    let jwallet_code: Cell;
    let minter_code: Cell;

    let jettonMinter: SandboxContract<JettonMinter>;

    // Safe factory
    let transferable_safe_factory: SandboxContract<SafeFactory>;
    let not_transferable_safe_factory: SandboxContract<SafeFactory>;
    let safe_factory_code: Cell;

    // Safe
    let safe_code: Cell;
    let transferableSafeAddress: Address;
    let notTransferableSafeAddress: Address;

    let jetton_sender_jetton_wallet: SandboxContract<JettonWallet>;
    let jetton_receiver_jetton_wallet: SandboxContract<JettonWallet>;
    let transferable_safe_factory_jetton_wallet: SandboxContract<JettonWallet>;

    let SafeFactoryDeploy: SendMessageResult;

    beforeAll(async () => {
        safe_factory_code = await compile('/SafeFactory/SafeFactory');
        jwallet_code = await compile('/Jetton/JettonWallet');
        minter_code = await compile('/Jetton/JettonMinter');
        safe_code = await compile('/Safe/Safe');
    });

    beforeEach(async () => {
        // Blockchain
        blockchain = await Blockchain.create();
        blockchain.now = BLOCKCHAIN_START_TIME;

        jetton_sender = await blockchain.treasury('jetton_sender');
        jetton_receiver = await blockchain.treasury('jetton_receiver');
        not_jetton_receiver = await blockchain.treasury('not_jetton_receiver');

        jettonMinter = openContractJettonMinter(blockchain, jetton_sender.address, jwallet_code, minter_code);

        jettonUserWallet = async (address: Address) =>
            blockchain.openContract(JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(address)));

        // Need to add safe type TYPE!
        transferable_safe_factory = openContractSafeFactory(
            blockchain,
            safe_code,
            jettonMinter.address,
            jetton_sender.address,
            safe_factory_code,
            true,
        );

        not_transferable_safe_factory = openContractSafeFactory(
            blockchain,
            safe_code,
            jettonMinter.address,
            jetton_sender.address,
            safe_factory_code,
            false,
        );

        // Preparations: deploy jetton minter + set initial balance to jetton wallets and check it
        await jettonMinter.sendDeploy(jetton_sender.getSender(), toNano('1'));

        jetton_sender_jetton_wallet = await jettonUserWallet(jetton_sender.address);
        jetton_receiver_jetton_wallet = await jettonUserWallet(jetton_receiver.address);

        await jettonMinter.sendMint(
            jetton_sender.getSender(),
            jetton_sender.address,
            INITIAL_JETTON_BALANCE,
            toNano('0.05'),
            toNano('1'),
        );
        await jettonMinter.sendMint(
            jetton_sender.getSender(),
            jetton_receiver.address,
            INITIAL_JETTON_BALANCE,
            toNano('0.05'),
            toNano('1'),
        );
        await jettonMinter.sendMint(
            jetton_sender.getSender(),
            not_jetton_receiver.address,
            INITIAL_JETTON_BALANCE,
            toNano('0.05'),
            toNano('1'),
        );

        expect(await jetton_sender_jetton_wallet.getJettonBalance()).toBe(INITIAL_JETTON_BALANCE);
        expect(await jetton_receiver_jetton_wallet.getJettonBalance()).toBe(INITIAL_JETTON_BALANCE);

        SafeFactoryDeploy = await transferable_safe_factory.sendDeploy(jetton_sender.getSender(), toNano('1'));
        await not_transferable_safe_factory.sendDeploy(jetton_sender.getSender(), toNano('1'));
    });

    it('Deploys safe factory successful', async () => {
        // ... --> jetton_sender
        expect(SafeFactoryDeploy.transactions).toHaveTransaction({
            from: undefined,
            to: jetton_sender.address,
            success: true,
        });
        // jetton_sender --> transferable_safe_factory
        expect(SafeFactoryDeploy.transactions).toHaveTransaction({
            from: jetton_sender.address,
            to: transferable_safe_factory.address,
            success: true,
            deploy: true,
        });
        // safe_factory --> jettonMinter (requesting our contract own jetton wallet)
        expect(SafeFactoryDeploy.transactions).toHaveTransaction({
            from: transferable_safe_factory.address,
            to: jettonMinter.address,
            success: true,
        });
        // jettonMinter --> transferable_safe_factory (respond to request)
        expect(SafeFactoryDeploy.transactions).toHaveTransaction({
            from: transferable_safe_factory.address,
            to: jettonMinter.address,
            success: true,
        });

        expect(SafeFactoryDeploy.transactions).toHaveLength(4);

        // Check, that there's no minted safes yet
        expect(await transferable_safe_factory.getNextItemIndex()).toBe(BigInt(0));
    });

    describe('Safe Factory', () => {
        let sentAmount: bigint;
        let forwardAmount: bigint;

        let jettonSenderBalanceBeforeTransfer: bigint;
        let jettonReceiverBalanceBeforeTransfer: bigint;

        let jettonSenderBalanceAfterTransfer: bigint;
        let transferableSafeFactoryBalanceAfterTransfer: bigint;

        let sentTransferJettonsResult: SendMessageResult;
        let sentTransferJettonsToNotTransferableSafeResult: SendMessageResult;

        let safe_data: Cell;

        let deployedTransferableSafe: SandboxContract<Safe>;
        let deployedNotTransferableSafe: SandboxContract<Safe>;

        beforeAll(async () => {
            sentAmount = toNano('50');
            forwardAmount = toNano('0.3');

            // Safe factory payload for minting safe
            safe_data = SafeFactory.safeMintPayloadToCell({
                jetton_receiver: jetton_receiver.address,
                vesting_start_time: VESTING_START_TIME,
                cliff_duration: CLIFF_DURATION,
                vesting_total_duration: VESTING_TOTAL_DURATION,
                unlock_period: UNLOCK_PERIOD,
                initially_unlocked_percentage: INITIALLY_UNLOCKED_PERCENTAGE,
            });
        });

        beforeEach(async () => {
            transferable_safe_factory_jetton_wallet = await jettonUserWallet(transferable_safe_factory.address);

            await jettonMinter.sendMint(
                jetton_sender.getSender(),
                transferable_safe_factory.address,
                BigInt(0),
                toNano('0.05'),
                toNano('1'),
            );

            await jettonMinter.sendMint(
                jetton_sender.getSender(),
                not_transferable_safe_factory.address,
                BigInt(0),
                toNano('0.05'),
                toNano('1'),
            );

            // Jetton balance before
            jettonSenderBalanceBeforeTransfer = await jetton_sender_jetton_wallet.getJettonBalance();
            jettonReceiverBalanceBeforeTransfer = await jetton_receiver_jetton_wallet.getJettonBalance();

            // Transfering
            sentTransferJettonsResult = await jetton_sender_jetton_wallet.sendTransfer(
                jetton_sender.getSender(),
                toNano('1'), //tons
                sentAmount,
                transferable_safe_factory.address,
                jetton_sender.address,
                beginCell().endCell(),
                forwardAmount,
                safe_data,
            );

            // We assume we can extract safe address exactly from 5th transaction.
            const transferableSafeAddressBigIntFormat: bigint = sentTransferJettonsResult.transactions[5].address;
            transferableSafeAddress = Address.parseRaw(
                '0:' + transferableSafeAddressBigIntFormat.toString(16).padStart(64, '0'),
            );

            deployedTransferableSafe = blockchain.openContract(
                Safe.createFromAddress(Address.parse(transferableSafeAddress.toString())),
            );

            jettonSenderBalanceAfterTransfer = await jetton_sender_jetton_wallet.getJettonBalance();
            transferableSafeFactoryBalanceAfterTransfer =
                await transferable_safe_factory_jetton_wallet.getJettonBalance();

            ////////////////

            sentTransferJettonsToNotTransferableSafeResult = await jetton_sender_jetton_wallet.sendTransfer(
                jetton_sender.getSender(),
                toNano('1'), //tons
                sentAmount,
                not_transferable_safe_factory.address,
                jetton_sender.address,
                beginCell().endCell(),
                forwardAmount,
                safe_data,
            );

            const notTransferableSafeAddressBigIntFormat: bigint =
                sentTransferJettonsToNotTransferableSafeResult.transactions[5].address;
            notTransferableSafeAddress = Address.parseRaw(
                '0:' + notTransferableSafeAddressBigIntFormat.toString(16).padStart(64, '0'),
            );

            deployedNotTransferableSafe = blockchain.openContract(
                Safe.createFromAddress(Address.parse(notTransferableSafeAddress.toString())),
            );
        });

        describe('when transfer Jettons', () => {
            it('mints safe', async () => {
                // transferable_safe_factory --> transferableSafeAddress
                expect(sentTransferJettonsResult.transactions).toHaveTransaction({
                    from: transferable_safe_factory.address,
                    to: transferableSafeAddress,
                    success: true,
                    deploy: true,
                });

                expect(sentTransferJettonsResult.transactions).toHaveTransaction({
                    from: jetton_sender_jetton_wallet.address,
                    to: transferable_safe_factory_jetton_wallet.address,
                    success: true,
                });
            });

            it('changes jetton balances', async () => {
                expect(BigInt(jettonSenderBalanceBeforeTransfer - jettonSenderBalanceAfterTransfer)).toEqual(
                    BigInt(sentAmount),
                );
                expect(transferableSafeFactoryBalanceAfterTransfer).toEqual(BigInt(sentAmount));
            });
        });

        describe('Safe instance', () => {
            describe('when claiming', () => {
                describe('by not receiver', () => {
                    it('does not allow to do anything', async () => {
                        const sendClaimSafeResult = await deployedTransferableSafe.sendClaimSafeMessage(
                            not_jetton_receiver.getSender(),
                        );

                        expect(sendClaimSafeResult.transactions).toHaveTransaction({
                            from: not_jetton_receiver.address,
                            to: deployedTransferableSafe.address,
                            success: false,
                            exitCode: ExitCode.incorrect_sender, // incorrect sender
                        });
                    });
                });

                describe('by receiver', () => {
                    describe('before vesting start time', () => {
                        it('claims 0', async () => {
                            blockchain.now = VESTING_START_TIME - 1;

                            await deployedTransferableSafe.sendClaimSafeMessage(jetton_receiver.getSender());
                            const jettonReceiverBalanceAfterTransfer =
                                await jetton_receiver_jetton_wallet.getJettonBalance();

                            expect(
                                BigInt(jettonReceiverBalanceAfterTransfer - jettonReceiverBalanceBeforeTransfer),
                            ).toEqual(BigInt(0));
                        });
                    });

                    describe('during cliff time', () => {
                        it('claims initially_unlocked_percentage', async () => {
                            blockchain.now = VESTING_START_TIME + CLIFF_DURATION - 1;

                            await deployedTransferableSafe.sendClaimSafeMessage(jetton_receiver.getSender());
                            const jettonReceiverBalanceAfterTransfer =
                                await jetton_receiver_jetton_wallet.getJettonBalance();

                            const unlocked_during_cliff =
                                (sentAmount * BigInt(INITIALLY_UNLOCKED_PERCENTAGE)) / BigInt(100);

                            expect(
                                BigInt(jettonReceiverBalanceAfterTransfer - jettonReceiverBalanceBeforeTransfer),
                            ).toEqual(unlocked_during_cliff);
                        });
                    });

                    describe('after cliff + 1.5 periods', () => {
                        beforeAll(async () => {});

                        it('claims initially_unlocked_percentage + linear unvested part (= 1 period)', async () => {
                            blockchain.now = VESTING_START_TIME + CLIFF_DURATION + 1.5 * UNLOCK_PERIOD;

                            await deployedTransferableSafe.sendClaimSafeMessage(jetton_receiver.getSender());
                            const jettonReceiverBalanceAfterTransfer =
                                await jetton_receiver_jetton_wallet.getJettonBalance();

                            // |-----------|------------/------------/------------/------------/------------/................|
                            // |---cliff---|---period---/---period---/---period---/---period---/---period---/................|
                            // |-----------|------------/------------/------------/------------/------------/................|
                            //                                /\
                            //                                ||
                            //       5          4.5        We are here

                            expect(
                                BigInt(jettonReceiverBalanceAfterTransfer - jettonReceiverBalanceBeforeTransfer),
                            ).toEqual(BigInt(toNano('9.5')));
                        });
                    });

                    describe('after cliff + 2.5 periods + 2.5 period', () => {
                        it('claims initially_unlocked_percentage + linear unvested part (5 periods)', async () => {
                            blockchain.now = VESTING_START_TIME + CLIFF_DURATION + 2.5 * UNLOCK_PERIOD;
                            await deployedTransferableSafe.sendClaimSafeMessage(jetton_receiver.getSender());

                            blockchain.now = blockchain.now + 2.5 * UNLOCK_PERIOD;
                            await deployedTransferableSafe.sendClaimSafeMessage(jetton_receiver.getSender());

                            const jettonReceiverBalanceAfterTransfer =
                                await jetton_receiver_jetton_wallet.getJettonBalance();

                            // |-----------|------------/------------/------------/------------/------------/................|
                            // |---cliff---|---period---/---period---/---period---/---period---/---period---/................|
                            // |-----------|------------/------------/------------/------------/------------/................|
                            //                                            /\                               /\
                            //                                            ||                               ||
                            //       5          4.5          4.5      1'st claim     4.5           4.5  2'nd claim
                            //                                           4.5                           (We are here)

                            expect(
                                BigInt(jettonReceiverBalanceAfterTransfer - jettonReceiverBalanceBeforeTransfer),
                            ).toEqual(BigInt(toNano('27.5')));
                        });
                    });

                    describe('after vesting total duration', () => {
                        it('claims everything', async () => {
                            blockchain.now = VESTING_START_TIME + VESTING_TOTAL_DURATION;
                            await deployedTransferableSafe.sendClaimSafeMessage(jetton_receiver.getSender());

                            const jettonReceiverBalanceAfterTransfer =
                                await jetton_receiver_jetton_wallet.getJettonBalance();

                            // |-----------|------------/------------/------------/------------/------------/................|
                            // |---cliff---|---period---/---period---/---period---/---period---/---period---/................|
                            // |-----------|------------/------------/------------/------------/------------/................|
                            //                                                                                               /\
                            //                                                                                               ||
                            //       5          4.5          4.5          4.5          4.5          4.5                   We are here
                            //

                            expect(
                                BigInt(jettonReceiverBalanceAfterTransfer - jettonReceiverBalanceBeforeTransfer),
                            ).toEqual(BigInt(sentAmount));
                        });
                    });

                    describe('two times in a row', () => {
                        it('fails second time', async () => {
                            blockchain.now = VESTING_START_TIME + SOME_TIME_AFTER_VESTING_START;

                            const sendClaimSafePromise = deployedTransferableSafe.sendClaimSafeMessage(
                                jetton_receiver.getSender(),
                            );
                            deployedTransferableSafe.sendClaimSafeMessage(jetton_receiver.getSender());

                            const sendFirstClaimSafeResult = await sendClaimSafePromise;

                            // One transaction succeed
                            expect(sendFirstClaimSafeResult.transactions).toHaveTransaction({
                                from: jetton_receiver.address,
                                to: deployedTransferableSafe.address,
                                success: true,
                            });

                            // One transaction failed
                            expect(sendFirstClaimSafeResult.transactions).toHaveTransaction({
                                from: jetton_receiver.address,
                                to: deployedTransferableSafe.address,
                                success: false,
                                exitCode: ExitCode.already_claimed, // already_claimed
                            });
                        });
                    });
                });
            });

            describe('when transfering', () => {
                describe('that is not transferable', () => {
                    let next_owner: SandboxContract<TreasuryContract>;

                    it('failed', async () => {
                        next_owner = await blockchain.treasury('next_owner');

                        const sendTransferSafeResult = await deployedNotTransferableSafe.sendTransferSafe(
                            jetton_receiver.getSender(),
                            next_owner.address,
                            toNano('0'),
                        );

                        expect(sendTransferSafeResult.transactions).toHaveTransaction({
                            from: jetton_receiver.address,
                            to: deployedNotTransferableSafe.address,
                            success: false,
                            exitCode: ExitCode.transfer_not_allowed, // not the owner
                        });
                    });
                });

                describe('that is transferable', () => {
                    describe('by owner (jetton_receiver)', () => {
                        let next_owner: SandboxContract<TreasuryContract>;

                        it('successfully completed', async () => {
                            next_owner = await blockchain.treasury('next_owner');

                            await deployedTransferableSafe.sendTransferSafe(
                                jetton_receiver.getSender(),
                                next_owner.address,
                                toNano('0'),
                            );

                            // next_owner owns safe now
                            expect((await deployedTransferableSafe.getStorageData()).owner_address.toString()).toEqual(
                                next_owner.address.toString(),
                            );
                        });
                    });

                    describe('by NOT owner (not_jetton_receiver)', () => {
                        let next_owner: SandboxContract<TreasuryContract>;

                        it('ends with error', async () => {
                            next_owner = await blockchain.treasury('next_owner');

                            const sendTransferSafeResult = await deployedTransferableSafe.sendTransferSafe(
                                not_jetton_receiver.getSender(),
                                next_owner.address,
                                toNano('0'),
                            );

                            expect(sendTransferSafeResult.transactions).toHaveTransaction({
                                from: not_jetton_receiver.address,
                                to: deployedTransferableSafe.address,
                                success: false,
                                exitCode: ExitCode.only_owner_can_transfer, // not the owner
                            });
                        });
                    });
                });
            });
        });
    });
});
