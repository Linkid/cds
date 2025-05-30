package cdn

import (
	"context"
	"net/http"

	"github.com/ovh/cds/engine/api/database/gorpmapping"
	"github.com/ovh/cds/engine/cdn/item"
	"github.com/ovh/cds/engine/cdn/storage"
	"github.com/ovh/cds/sdk"

	"github.com/ovh/cds/engine/service"
)

func (s *Service) postDuplicateItemForJobHandler() service.Handler {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
		var duplicateRequest sdk.CDNDuplicateItemRequest
		if err := service.UnmarshalBody(r, &duplicateRequest); err != nil {
			return err
		}

		items, err := item.LoadByRunJobID(ctx, s.Mapper, s.mustDBWithCtx(ctx), duplicateRequest.FromJob, gorpmapping.GetAllOptions.WithDecryption)
		if err != nil {
			return err
		}

		tx, err := s.mustDBWithCtx(ctx).Begin()
		if err != nil {
			return sdk.WithStack(err)
		}
		defer tx.Rollback() // nolint
		for _, i := range items {
			newItem := i
			newItem.ID = ""
			switch newItem.Type {
			case sdk.CDNTypeItemJobStepLog, sdk.CDNTypeItemServiceLogV2:
				logRef, _ := newItem.GetCDNLogApiRefV2()
				logRef.RunJobID = duplicateRequest.ToJob
				logRef.RunAttempt++
				newItem.APIRef = logRef

				hashRef, err := logRef.ToHash()
				if err != nil {
					return err
				}
				newItem.APIRefHash = hashRef
			case sdk.CDNTypeItemRunResultV2:
				logRef, _ := newItem.GetCDNRunResultApiRefV2()
				logRef.RunJobID = duplicateRequest.ToJob
				logRef.RunAttempt++
				newItem.APIRef = logRef
				hashRef, err := logRef.ToHash()
				if err != nil {
					return err
				}
				newItem.APIRefHash = hashRef
			default:
				return sdk.WrapError(sdk.ErrInvalidData, "wrong item type %s", newItem.Type)
			}
			if err := item.Insert(ctx, s.Mapper, tx, &newItem); err != nil {
				return err
			}

			// Load storage unit item
			storageUnitItems, err := storage.LoadAllItemUnitsByItemIDs(ctx, s.Mapper, tx, i.ID, gorpmapping.GetAllOptions.WithDecryption)
			if err != nil {
				return err
			}
			for _, sui := range storageUnitItems {
				newSUI := sui
				newSUI.ID = ""
				newSUI.ItemID = newItem.ID
				newSUI.Item = &newItem
				if err := storage.InsertItemUnit(ctx, s.Mapper, tx, &newSUI); err != nil {
					return err
				}

				if sui.UnitID == s.Units.LogsBuffer().ID() {
					// Copy logs in buffer
					if err := s.Units.LogsBuffer().Copy(ctx, i.ID, newItem.ID); err != nil {
						return err
					}
				}
			}
		}
		return sdk.WithStack(tx.Commit())
	}
}
