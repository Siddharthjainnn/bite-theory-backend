import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
  import { ServeStaticModule } from '@nestjs/serve-static';
    import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminWriteGuard } from './common/admin-write.guard';

// existing modules
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { OrderItemsModule } from './order-items/order-items.module';
import { UploadModule } from './upload/upload.module';

// new modules
import { UserModule } from './users/users.module';
import { AddressModule } from './addresses/addresses.module';
import { CouponModule } from './coupons/coupons.module';
import { ReviewModule } from './reviews/reviews.module';
import { ReferralModule } from './referrals/referrals.module';
import { LoyaltyPointModule } from './loyalty_points/loyalty_points.module';
import { WalletTransactionModule } from './wallet_transactions/wallet_transactions.module';
import { NotificationModule } from './notifications/notifications.module';
import { SupportTicketModule } from './support_tickets/support_tickets.module';
import { PaymentModule } from './payments/payments.module';
import { FavoriteModule } from './favorites/favorites.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrderStatusHistoryModule } from './order_status_history/order_status_history.module';
import { DeliveryPartnerModule } from './delivery_partners/delivery_partners.module';
import { BannerModule } from './banners/banners.module';
import { CampaignModule } from './campaigns/campaigns.module';
import { RoleModule } from './roles/roles.module';
import { PermissionModule } from './permissions/permissions.module';
import { AdminUserModule } from './admin_users/admin_users.module';
import { AuditLogModule } from './audit_logs/audit_logs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      synchronize: false,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    }),

    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      serveRoot: '/',         // so /uploads/... is reachable
    }),
    // existing
    CategoriesModule,
    ProductsModule,
    OrdersModule,
    OrderItemsModule,

    // new
    UserModule,
    AddressModule,
    CouponModule,
    ReviewModule,
    ReferralModule,
    LoyaltyPointModule,
    WalletTransactionModule,
    NotificationModule,
    SupportTicketModule,
    PaymentModule,
    FavoriteModule,
    InventoryModule,
    OrderStatusHistoryModule,
    DeliveryPartnerModule,
    BannerModule,
    CampaignModule,
    RoleModule,
    PermissionModule,
    AdminUserModule,
    AuditLogModule,
    UploadModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AdminWriteGuard },
  ],
})
export class AppModule {}