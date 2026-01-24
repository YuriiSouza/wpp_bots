import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramService {
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(chatId: number, text: string) {
    await axios.post(`${this.baseUrl}/sendMessage`, {
      chat_id: chatId,
      text,
    });
  }
}
