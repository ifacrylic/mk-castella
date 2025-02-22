/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { checkWordMute } from '@/misc/check-word-mute.js';
import { isUserRelated } from '@/misc/is-user-related.js';
import { isInstanceMuted } from '@/misc/is-instance-muted.js';
import type { Packed } from '@/misc/json-schema.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { bindThis } from '@/decorators.js';
import Channel from '../channel.js';

class HomeTimelineChannel extends Channel {
	public readonly chName = 'homeTimeline';
	public static shouldShare = false;
	public static requireCredential = true;
	private withRenotes: boolean;

	constructor(
		private noteEntityService: NoteEntityService,

		id: string,
		connection: Channel['connection'],
	) {
		super(id, connection);
		//this.onNote = this.onNote.bind(this);
	}

	@bindThis
	public async init(params: any) {
		this.withRenotes = params.withRenotes ?? true;

		this.subscriber.on('notesStream', this.onNote);
	}

	@bindThis
	private async onNote(note: Packed<'Note'>) {
		if (note.channelId) {
			if (!this.followingChannels.has(note.channelId)) return;
		} else {
			// その投稿のユーザーをフォローしていなかったら弾く
			if ((this.user!.id !== note.userId) && !Object.hasOwn(this.following, note.userId)) return;
		}

		// Ignore notes from instances the user has muted
		if (isInstanceMuted(note, new Set<string>(this.userProfile!.mutedInstances ?? []))) return;

		if (['followers', 'specified'].includes(note.visibility)) {
			note = await this.noteEntityService.pack(note.id, this.user!, {
				detail: true,
			});

			if (note.isHidden) {
				return;
			}
		} else {
			// リプライなら再pack
			if (note.replyId != null) {
				note.reply = await this.noteEntityService.pack(note.replyId, this.user!, {
					detail: true,
				});
			}
			// Renoteなら再pack
			if (note.renoteId != null) {
				note.renote = await this.noteEntityService.pack(note.renoteId, this.user!, {
					detail: true,
				});
			}
		}

		// 関係ない返信は除外
		if (note.reply && !this.following[note.userId]?.withReplies) {
			const reply = note.reply;
			// 「チャンネル接続主への返信」でもなければ、「チャンネル接続主が行った返信」でもなければ、「投稿者の投稿者自身への返信」でもない場合
			if (reply.userId !== this.user!.id && note.userId !== this.user!.id && reply.userId !== note.userId) return;
		}

		if (note.renote && note.text == null && (note.fileIds == null || note.fileIds.length === 0) && !this.withRenotes) return;

		// 流れてきたNoteがミュートしているユーザーが関わるものだったら無視する
		if (isUserRelated(note, this.userIdsWhoMeMuting)) return;
		// 流れてきたNoteがブロックされているユーザーが関わるものだったら無視する
		if (isUserRelated(note, this.userIdsWhoBlockingMe)) return;

		if (note.renote && !note.text && isUserRelated(note, this.userIdsWhoMeMutingRenotes)) return;

		this.connection.cacheNote(note);

		this.send('note', note);
	}

	@bindThis
	public dispose() {
		// Unsubscribe events
		this.subscriber.off('notesStream', this.onNote);
	}
}

@Injectable()
export class HomeTimelineChannelService {
	public readonly shouldShare = HomeTimelineChannel.shouldShare;
	public readonly requireCredential = HomeTimelineChannel.requireCredential;

	constructor(
		private noteEntityService: NoteEntityService,
	) {
	}

	@bindThis
	public create(id: string, connection: Channel['connection']): HomeTimelineChannel {
		return new HomeTimelineChannel(
			this.noteEntityService,
			id,
			connection,
		);
	}
}
