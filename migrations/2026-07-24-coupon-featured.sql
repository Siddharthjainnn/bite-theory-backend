-- Bug #69: the cart/home pages auto-promoted whichever active coupon came
-- first, with no admin intent. Coupons are only advertised on the storefront
-- when the admin explicitly features them.
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false;
