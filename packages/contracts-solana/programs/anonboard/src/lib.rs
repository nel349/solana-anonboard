//! Minimal Solana program backing the anonboard example. See the README for how
//! it fits into the sync node / batcher round-trip.
//!
//! One instruction:
//!   - `Post(body)` emits `ANONBOARD_POST|<author>|<slot>|<body>` — the post the
//!     sync node counts once the author holds a membership badge.
//!
//! Feeless for the user: the post writes no account, so the author only has to
//! *sign* ( free ) to authorize the post; the transaction's fee payer is a
//! sponsor. A user never needs to hold SOL.
//!
//! No Anchor — plain `solana-program` so it builds with the vendored
//! `cargo-build-sbf` (Solana 1.18.x) without the Anchor CLI.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::Sysvar,
};

solana_program::declare_id!("8veT8XVnBxG6kmq27CrCgznCtVHLJsBAqGHZrodKaRJ6");

/// Post a message. Writes no account; the emitted log line is the record.
pub const DISCRIMINANT_POST: u8 = 2;

entrypoint!(process_instruction);

pub fn process_instruction<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    let _ = program_id;

    // Wire format for the sync node: ANONBOARD_POST|<author>|<slot>|<body>.
    // Body is last so it may itself contain '|' without breaking the parse.
    if instruction_data.first().copied() == Some(DISCRIMINANT_POST) {
        let account_info_iter = &mut accounts.iter();
        let author_info = next_account_info(account_info_iter)?;
        if !author_info.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }
        let body = core::str::from_utf8(&instruction_data[1..])
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        let slot = Clock::get()?.slot;
        msg!("ANONBOARD_POST|{}|{}|{}", author_info.key, slot, body);
        return Ok(());
    }

    Err(ProgramError::InvalidInstructionData)
}
