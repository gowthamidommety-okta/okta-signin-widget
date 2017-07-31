/*!
 * Copyright (c) 2015-2016, Okta, Inc. and/or its affiliates. All rights reserved.
 * The Okta software accompanied by this notice is provided pursuant to the Apache License, Version 2.0 (the "License.")
 *
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *
 * See the License for the specific language governing permissions and limitations under the License.
 */

define([
  'okta',
  'BaseCallAndSmsController',
  'views/enroll-factors/Footer',
  'views/enroll-factors/PhoneTextBox',
  'views/shared/TextBox',
  'util/CountryUtil',
  'util/FormType',
  'shared/util/Keys'
],
function (Okta, BaseCallAndSmsController, Footer, PhoneTextBox, TextBox, CountryUtil, FormType, Keys) {

  var _ = Okta._;
  var PUSH_INTERVAL = 6000;

  function sendPush(e) {
    if (Keys.isEnter(e)) {
      e.stopPropagation();
      e.preventDefault();
      if (e.type === 'keyup' && e.data && e.data.model) {
        e.data.model.sendPush();
      }
    }
  }

  return BaseCallAndSmsController.extend({
    className: 'enroll-call',
    setModel: function() {
      _.extend(this.model, {
        sendPush: function () {
          var self = this;
          var phoneNumber = this.get('fullPhoneNumber');
          var phoneExtension = this.get('phoneExtension');

          self.trigger('errors:clear');

          if(!phoneNumber.length) {
            self.trigger('invalid', self, {'phoneNumber': 'model.validation.field.blank'});
            return;
          }

          return this.doTransaction(function(transaction) {
            var isMfaEnroll = transaction.status === 'MFA_ENROLL';
            var profileData = {
              phoneNumber: phoneNumber,
              updatePhone: isMfaEnroll ? self.get('hasExistingPhones') : true,
              phoneExtension: phoneExtension
            };

            if (self.get('skipPhoneValidation')) {
              profileData['validatePhone'] = false;
            }

            var doEnroll = function (trans) {
              var factor = _.findWhere(trans.factors, {
                factorType: self.get('factorType'),
                provider: 'OKTA'
              });
              return factor.enroll({
                profile: profileData
              })
              .then(function (trans) {
                self.set('lastEnrolledPhoneNumber', phoneNumber);
                self.limitResending();
                return trans.poll(PUSH_INTERVAL);
              })
              .fail(function (error) {
                if(error.errorCode === 'E0000098') { // E0000098: "This phone number is invalid."
                  self.set('skipPhoneValidation', true);
                  error.xhr.responseJSON.errorSummary = Okta.loc('enroll.sms.try_again', 'login');
                }
                throw error;
              });
            };

            if (isMfaEnroll) {
              return doEnroll(transaction);
            }
            else {
              // We must transition to MfaEnroll before updating the phone number
              self.set('trapEnrollment', true);
              return transaction.prev()
              .then(doEnroll)
              .then(function (trans) {
                self.set('trapEnrollment', false);
                return trans;
              });
            }
          // Rethrow errors so we can change state
          // AFTER setting the new transaction
          }, true)
          .fail(function () {
            self.set('ableToResend', true);
            self.set('trapEnrollment', false);
          });
        }
      });
    },

    Form: function () {
      var factorType = this.options.factorType;

      var formTitle = Okta.loc('enroll.call.setup', 'login');
      var formSubmit = Okta.loc('mfa.call', 'login');
      var formRetry = Okta.loc('mfa.redial', 'login');
      var formSubmitted = Okta.loc('mfa.calling', 'login');

      var numberFieldClassName = 'enroll-call-phone';
      var buttonClassName = 'call-request-button';

      var formChildren = [
        FormType.Input({
          name: 'countryCode',
          type: 'select',
          wide: true,
          options: CountryUtil.getCountries()
        }),
        FormType.Input({
          placeholder: Okta.loc('mfa.phoneNumber.placeholder', 'login'),
          className: numberFieldClassName,
          name: 'phoneNumber',
          input: PhoneTextBox,
          type: 'text',
          render: function () {
            this.$('input[name="phoneNumber"]')
              .off('keydown keyup', sendPush)
              .keydown(sendPush)
              .keyup({model: this.model}, sendPush);
          }
        })
      ];
      formChildren.push(FormType.Input({
        placeholder: Okta.loc('mfa.phoneNumber.ext.placeholder', 'login'),
        className: 'enroll-call-extension',
        name: 'phoneExtension',
        input: TextBox,
        type: 'text'
      }));
      formChildren.push(
        FormType.Button({
          title: formSubmit,
          attributes: { 'data-se': buttonClassName },
          className: 'button button-primary js-enroll-phone ' + buttonClassName,
          click: function () {
            this.model.sendPush();
          }
        }),
        FormType.Button({
          title: formRetry,
          attributes: { 'data-se': buttonClassName },
          className: 'button js-enroll-phone ' + buttonClassName,
          click: function () {
            this.model.resendCode();
          },
          initialize: function () {
            this.$el.css({display: 'none'});
            this.listenTo(this.model, 'change:ableToResend', function (model, ableToResend) {
              if (ableToResend) {
                this.options.title = formRetry;
                this.enable();
              } else {
                this.options.title = formSubmitted;
                this.disable();
              }
              this.render();
            });
          }
        })
      );

      return {
        title: formTitle,
        noButtonBar: true,
        autoSave: true,
        className: 'enroll-call',
        initialize: function () {
          this.listenTo(this.model, 'error errors:clear', function () {
            this.clearErrors();
          });
          this.listenTo(this.model, 'change:enrolled', function () {
            this.$('.js-enroll-phone').toggle();
          });
        },
        formChildren: formChildren
      };
    },

    Footer: Footer,

    initialize: function () {
      this.setModel();
      this.setProperties();
      this.listenTo(this.options.appState, 'change:isMfaRejectedByUser',
        function (state, isMfaRejectedByUser) {
          this.model.set('ableToResend', true);
          if (isMfaRejectedByUser) {
            this.model.trigger('error', this.model, 
              {responseJSON: {errorSummary: Okta.loc('oktaverify.rejected', 'login')}}
            );
          }
        }
      );
      this.listenTo(this.options.appState, 'change:isMfaTimeout',
        function (state, isMfaTimeout) {
          this.model.set('ableToResend', true);
          if (isMfaTimeout) {
            this.model.trigger('error', this.model, 
              {responseJSON: {errorSummary: 'Your call has expired' }}
            );
          }
        }
      );
    }
  });
});
