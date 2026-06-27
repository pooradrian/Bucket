import {Image, Text, TouchableOpacity, View} from 'react-native';
import {Character} from '../CharacterEditor';
import {useTheme} from '../ThemeContext';

interface CharacterCardProps {
  item: Character;
  showCharacterIcons: boolean;
  isConfirmingDelete: boolean;
  hideEdit?: boolean;
  onOpenChat: (char: Character) => void;
  onEdit: (char: Character) => void;
  onTriggerDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
}

export default function CharacterCard({
  item,
  showCharacterIcons,
  isConfirmingDelete,
  hideEdit,
  onOpenChat,
  onEdit,
  onTriggerDelete,
  onConfirmDelete,
  onCancelDelete,
}: CharacterCardProps) {
  const st = useTheme();

  return (
    <View style={st.characterCard}>
      {showCharacterIcons && item.icon ? (
        <Image source={{uri: item.icon}} style={st.characterAvatar} />
      ) : null}
      <View style={st.characterInfo}>
        <TouchableOpacity
          onPress={() => onOpenChat(item)}
          activeOpacity={0.7}>
          <Text style={st.characterName}>{item.name}</Text>
          {item.description ? (
            <Text style={st.characterDesc} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
        </TouchableOpacity>

        <View style={st.cardActionRow}>
          {isConfirmingDelete ? (
            <>
              <TouchableOpacity
                onPress={() => onConfirmDelete(item.id)}
                style={st.confirmBtn}>
                <Text style={st.confirmBtnText}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onCancelDelete}
                style={[st.cardActionBtn, st.cardActionBtnLast]}>
                <Text style={st.cardActionBtnText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {!hideEdit && (
                <TouchableOpacity
                  onPress={() => onEdit(item)}
                  style={st.cardActionBtn}>
                  <Text style={st.cardActionBtnText}>Edit</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => onTriggerDelete(item.id)}
                style={[st.cardActionBtn, hideEdit ? {} : st.cardActionBtnLast]}>
                <Text style={st.cardActionBtnTextDanger}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
}
