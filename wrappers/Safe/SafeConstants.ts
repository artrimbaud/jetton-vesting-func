export abstract class Op {
    static claim_safe = 0xa769de27;
    static transfer_safe = 0x5fcc3d14;
}

export abstract class Gas {
    static jetton_transfer = 55000000n; //  0.055 TON
}
